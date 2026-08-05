import * as vscode from 'vscode';
import { GraphModel } from './model';
import { GraphNode, NodeKind } from './types';

/**
 * Symbol provider integration for expanding file nodes
 */
export class SymbolProvider {
	private model: GraphModel;

	constructor(model: GraphModel) {
		this.model = model;
	}

	/**
	 * Expand a file node to show its symbols
	 */
	async expandFile(nodeId: string): Promise<void> {
		const node = this.model.getNode(nodeId);
		if (!node || node.kind !== NodeKind.File) {
			return;
		}

		// Check if already expanded
		if (node.isExpanded) {
			return;
		}

		// Check node limit
		if (this.model.isOverNodeLimit()) {
			vscode.window.showWarningMessage(`Node limit (${this.model.getFilters().maxNodes}) reached. Increase limit in filters.`);
			return;
		}

		const fileUri = vscode.Uri.parse(node.uri!);
		const lowerPath = fileUri.fsPath.toLowerCase();
		if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
			node.isLeaf = true;
			node.metadata = {
				...(node.metadata || {}),
				skipSymbolExpansion: true,
				note: 'Markdown files are kept collapsed to avoid heading explosions.'
			};
			this.model.setNodeExpanded(nodeId, false);
			return;
		}

		try {
			const symbols = await this.getDocumentSymbols(fileUri);

			if (!symbols || symbols.length === 0) {
				// Avoid locking the node in expanded state when providers are still warming up.
				this.model.setNodeExpanded(nodeId, false);
				return;
			}

			let expandedFully = true;
			if (this.isDocumentSymbolArray(symbols)) {
				expandedFully = this.processDirectSymbols(fileUri, symbols, nodeId);
			} else {
				// Fallback for providers returning SymbolInformation[]
				expandedFully = this.processSymbolInfos(fileUri, symbols, nodeId);
			}

			if (!expandedFully) {
				this.model.setNodeExpanded(nodeId, false);
				vscode.window.showWarningMessage(
					`Node limit (${this.model.getFilters().maxNodes}) reached while expanding ${node.label}. Increase the limit in filters.`
				);
				return;
			}

			// Mark node as expanded
			node.isLeaf = false;
			this.model.setNodeExpanded(nodeId, true);

		} catch {
			// Keep the node retryable if provider fails transiently.
			this.model.setNodeExpanded(nodeId, false);
		}
	}

	/**
	 * Expand a symbol node to show only its direct child symbols.
	 */
	async expandSymbol(nodeId: string): Promise<void> {
		const node = this.model.getNode(nodeId);
		if (!node || !node.uri || !node.range || node.isExpanded || node.isLeaf) {
			return;
		}

		if (this.model.isOverNodeLimit()) {
			vscode.window.showWarningMessage(`Node limit (${this.model.getFilters().maxNodes}) reached. Increase limit in filters.`);
			return;
		}

		const fileUri = vscode.Uri.parse(node.uri);

		try {
			const symbols = await this.getDocumentSymbols(fileUri);
			if (!symbols || !this.isDocumentSymbolArray(symbols)) {
				node.isLeaf = true;
				this.model.emitUpdate();
				return;
			}

			const match = this.findDocumentSymbolById(fileUri, symbols, nodeId);
			if (!match || !match.symbol.children || match.symbol.children.length === 0) {
				node.isLeaf = true;
				this.model.emitUpdate();
				return;
			}

			const expandedFully = this.processDirectSymbols(
				fileUri,
				match.symbol.children,
				nodeId,
				match.symbolPath
			);

			if (!expandedFully) {
				this.model.setNodeExpanded(nodeId, false);
				vscode.window.showWarningMessage(
					`Node limit (${this.model.getFilters().maxNodes}) reached while expanding ${node.label}. Increase the limit in filters.`
				);
				return;
			}

			this.model.setNodeExpanded(nodeId, true);
		} catch {
			this.model.setNodeExpanded(nodeId, false);
		}
	}

	private async getDocumentSymbols(fileUri: vscode.Uri): Promise<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined> {
		// Warm up language services by ensuring the document is loaded first.
		await vscode.workspace.openTextDocument(fileUri);

		const retryDelaysMs = [0, 75, 150, 300];
		for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
			if (attempt > 0) {
				await this.wait(retryDelaysMs[attempt]);
			}

			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
				'vscode.executeDocumentSymbolProvider',
				fileUri
			);

			if (symbols && symbols.length > 0) {
				return symbols;
			}
		}

		return undefined;
	}

	private async wait(ms: number): Promise<void> {
		await new Promise<void>(resolve => {
			globalThis.setTimeout(resolve, ms);
		});
	}

	private isDocumentSymbolArray(
		symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[]
	): symbols is vscode.DocumentSymbol[] {
		const first = symbols[0] as vscode.DocumentSymbol | vscode.SymbolInformation | undefined;
		if (!first) {
			return true;
		}

		return 'children' in first;
	}

	private processDirectSymbols(
		fileUri: vscode.Uri,
		symbols: vscode.DocumentSymbol[],
		parentId: string,
		symbolPath: string = ''
	): boolean {
		for (const symbol of symbols) {
			// Check node limit
			if (this.model.isOverNodeLimit()) {
				return false;
			}

			const currentSymbolPath = symbolPath ? `${symbolPath}.${symbol.name}` : symbol.name;
			const symbolId = this.createSymbolId(fileUri, currentSymbolPath, symbol.range);

			const symbolNode: GraphNode = {
				id: symbolId,
				label: symbol.name,
				kind: this.mapSymbolKind(symbol.kind, symbol.name),
				uri: fileUri.toString(),
				range: symbol.range,
				isExpanded: false,
				isLeaf: !symbol.children || symbol.children.length === 0
			};

			this.model.addNode(symbolNode);
			this.model.addEdge(parentId, symbolId);
		}

		return true;
	}

	private findDocumentSymbolById(
		fileUri: vscode.Uri,
		symbols: vscode.DocumentSymbol[],
		nodeId: string,
		symbolPath: string = ''
	): { symbol: vscode.DocumentSymbol; symbolPath: string } | undefined {
		for (const symbol of symbols) {
			const currentSymbolPath = symbolPath ? `${symbolPath}.${symbol.name}` : symbol.name;
			const symbolId = this.createSymbolId(fileUri, currentSymbolPath, symbol.range);
			if (symbolId === nodeId) {
				return { symbol, symbolPath: currentSymbolPath };
			}

			if (symbol.children && symbol.children.length > 0) {
				const childMatch = this.findDocumentSymbolById(fileUri, symbol.children, nodeId, currentSymbolPath);
				if (childMatch) {
					return childMatch;
				}
			}
		}

		return undefined;
	}

	private processSymbolInfos(
		fileUri: vscode.Uri,
		symbols: vscode.SymbolInformation[],
		parentId: string
	): boolean {
		for (const [index, symbol] of symbols.entries()) {
			if (this.model.isOverNodeLimit()) {
				return false;
			}

			const symbolPath = `${symbol.containerName || 'root'}.${symbol.name}.${index}`;
			const symbolId = this.createSymbolId(fileUri, symbolPath, symbol.location.range);

			const symbolNode: GraphNode = {
				id: symbolId,
				label: symbol.name,
				kind: this.mapSymbolKind(symbol.kind, symbol.name),
				uri: fileUri.toString(),
				range: symbol.location.range,
				isExpanded: false,
				isLeaf: true
			};

			this.model.addNode(symbolNode);
			this.model.addEdge(parentId, symbolId);
		}

		return !this.model.isOverNodeLimit();
	}

	/**
	 * Create a stable symbol ID
	 */
	private createSymbolId(uri: vscode.Uri, symbolPath: string, range: vscode.Range): string {
		return `${uri.toString()}::${symbolPath}::${range.start.line}:${range.start.character}`;
	}

	/**
	 * Map VS Code symbol kind to our NodeKind
	 */
	private mapSymbolKind(kind: vscode.SymbolKind, name: string): NodeKind {
		switch (kind) {
			case vscode.SymbolKind.Class:
				return NodeKind.Class;
			case vscode.SymbolKind.Struct:
				return NodeKind.Struct;
			case vscode.SymbolKind.Function:
				return NodeKind.Function;
			case vscode.SymbolKind.Method:
				return NodeKind.Method;
			case vscode.SymbolKind.Variable:
				return NodeKind.Variable;
			case vscode.SymbolKind.Interface:
				return NodeKind.Interface;
			case vscode.SymbolKind.Enum:
				return NodeKind.Enum;
			case vscode.SymbolKind.EnumMember:
				return NodeKind.EnumMember;
			case vscode.SymbolKind.Namespace:
			case vscode.SymbolKind.Module:
				return NodeKind.Namespace;
			case vscode.SymbolKind.Object:
				return /^\s*impl\b/.test(name) ? NodeKind.Impl : NodeKind.Object;
			case vscode.SymbolKind.Property:
			case vscode.SymbolKind.Field:
				return NodeKind.Property;
			case vscode.SymbolKind.Constant:
				return NodeKind.Constant;
			case vscode.SymbolKind.Constructor:
				return NodeKind.Constructor;
			case vscode.SymbolKind.Operator:
				return NodeKind.Operator;
			case vscode.SymbolKind.TypeParameter:
				return NodeKind.TypeParameter;
			default:
				return NodeKind.Unknown;
		}
	}
}

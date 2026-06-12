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
				// Process hierarchical symbols recursively.
				expandedFully = this.processSymbols(fileUri, symbols, nodeId);
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
			this.model.setNodeExpanded(nodeId, true);

		} catch {
			// Keep the node retryable if provider fails transiently.
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

	/**
	 * Process symbols recursively
	 */
	private processSymbols(
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
				kind: this.mapSymbolKind(symbol.kind),
				uri: fileUri.toString(),
				range: symbol.range,
				isExpanded: false,
				isLeaf: !symbol.children || symbol.children.length === 0
			};

			this.model.addNode(symbolNode);
			this.model.addEdge(parentId, symbolId);

			// Process children if any
			if (symbol.children && symbol.children.length > 0) {
				const childrenCompleted = this.processSymbols(fileUri, symbol.children, symbolId, currentSymbolPath);
				if (!childrenCompleted) {
					return false;
				}
			}
		}

		return true;
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
				kind: this.mapSymbolKind(symbol.kind),
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
	private mapSymbolKind(kind: vscode.SymbolKind): NodeKind {
		switch (kind) {
			case vscode.SymbolKind.Class:
				return NodeKind.Class;
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
			case vscode.SymbolKind.Namespace:
			case vscode.SymbolKind.Module:
				return NodeKind.Namespace;
			case vscode.SymbolKind.Property:
			case vscode.SymbolKind.Field:
				return NodeKind.Property;
			case vscode.SymbolKind.Constant:
				return NodeKind.Constant;
			case vscode.SymbolKind.Constructor:
				return NodeKind.Constructor;
			default:
				return NodeKind.Unknown;
		}
	}
}

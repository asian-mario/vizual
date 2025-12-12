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

		try {
			// Execute document symbol provider
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				'vscode.executeDocumentSymbolProvider',
				fileUri
			);

			if (!symbols || symbols.length === 0) {
				// File has no symbols, mark as leaf
				node.isLeaf = true;
				this.model.setNodeExpanded(nodeId, true);
				return;
			}

			// Process symbols recursively
			this.processSymbols(fileUri, symbols, nodeId);

			// Mark node as expanded
			this.model.setNodeExpanded(nodeId, true);

		} catch (error) {
			console.error('Error expanding file symbols:', error);
			// Mark as leaf if we can't get symbols
			node.isLeaf = true;
			this.model.setNodeExpanded(nodeId, true);
		}
	}

	/**
	 * Process symbols recursively
	 */
	private processSymbols(
		fileUri: vscode.Uri,
		symbols: vscode.DocumentSymbol[],
		parentId: string,
		symbolPath: string = ''
	): void {
		for (const symbol of symbols) {
			// Check node limit
			if (this.model.isOverNodeLimit()) {
				break;
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
				this.processSymbols(fileUri, symbol.children, symbolId, currentSymbolPath);
			}
		}
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

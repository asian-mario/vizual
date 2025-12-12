import * as vscode from 'vscode';
import { GraphModel } from './model';
import { FileSystemScanner } from './scanner';
import { SymbolProvider } from './symbolProvider';
import { DebugStateTracker } from './debugTracker';
import { NodeKind, FilterConfig, ColorRule } from './types';

/**
 * Main graph controller that coordinates all components
 */
export class GraphController {
	private model: GraphModel;
	private scanner: FileSystemScanner;
	private symbolProvider: SymbolProvider;
	private debugTracker: DebugStateTracker;

	constructor(rootPath: string) {
		this.model = new GraphModel(rootPath);
		this.scanner = new FileSystemScanner(this.model);
		this.symbolProvider = new SymbolProvider(this.model);
		this.debugTracker = new DebugStateTracker(this.model);
	}

	/**
	 * Get the graph model
	 */
	getModel(): GraphModel {
		return this.model;
	}

	/**
	 * Initialize the graph with root node
	 */
	async initialize(): Promise<void> {
		await this.scanner.initializeRoot();
	}

	/**
	 * Expand a node (folder or file)
	 */
	async expandNode(nodeId: string): Promise<void> {
		const node = this.model.getNode(nodeId);
		if (!node) {
			return;
		}

		if (node.kind === NodeKind.Folder) {
			await this.scanner.expandFolder(nodeId);
		} else if (node.kind === NodeKind.File) {
			await this.symbolProvider.expandFile(nodeId);
		}
	}

	/**
	 * Open/reveal a node in VS Code
	 */
	async openNode(nodeId: string, reveal: boolean = false): Promise<void> {
		const node = this.model.getNode(nodeId);
		if (!node || !node.uri) {
			return;
		}

		const uri = vscode.Uri.parse(node.uri);

		// For folders, reveal in explorer
		if (node.kind === NodeKind.Folder) {
			await vscode.commands.executeCommand('revealInExplorer', uri);
			return;
		}

		// For files and symbols, open the file
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(document);

			// If it's a symbol with a range, reveal that range
			if (node.range) {
				editor.revealRange(node.range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(node.range.start, node.range.end);
			}

			// Optionally reveal in explorer
			if (reveal) {
				await vscode.commands.executeCommand('revealInExplorer', uri);
			}
		} catch (error) {
			console.error('Error opening node:', error);
			vscode.window.showErrorMessage(`Failed to open: ${node.label}`);
		}
	}

	/**
	 * Change the root path
	 */
	async setRootPath(path: string): Promise<void> {
		this.model.setRootPath(path);
		await this.initialize();
	}

	/**
	 * Update filters
	 */
	setFilters(filters: Partial<FilterConfig>): void {
		this.model.setFilters(filters);
	}

	/**
	 * Update color rules
	 */
	setColorRules(rules: ColorRule[]): void {
		this.model.setColorRules(rules);
	}

	/**
	 * Set active mode
	 */
	setActiveMode(value: boolean): void {
		this.model.setActiveMode(value);
	}

	/**
	 * Subscribe to model updates
	 */
	onUpdate(callback: () => void): vscode.Disposable {
		return this.model.onUpdate(callback);
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.debugTracker.dispose();
	}
}

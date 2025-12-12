import * as vscode from 'vscode';
import { GraphModel } from './model';

/**
 * Debug state tracker for breakpoint highlighting
 */
export class DebugStateTracker {
	private model: GraphModel;
	private disposables: vscode.Disposable[] = [];

	constructor(model: GraphModel) {
		this.model = model;
		this.initialize();
	}

	/**
	 * Initialize listeners
	 */
	private initialize(): void {
		// Listen for breakpoint changes
		this.disposables.push(
			vscode.debug.onDidChangeBreakpoints(() => {
				this.updateBreakpoints();
			})
		);

		// Listen for active editor changes
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.updateActiveEditor();
			})
		);

		// Initial update
		this.updateBreakpoints();
		this.updateActiveEditor();
	}

	/**
	 * Update breakpoint flags on nodes
	 */
	private updateBreakpoints(): void {
		const breakpoints = vscode.debug.breakpoints;
		const fileUrisWithBreakpoints = new Set<string>();

		// Collect file URIs that have breakpoints
		for (const bp of breakpoints) {
			if (bp instanceof vscode.SourceBreakpoint && bp.location.uri) {
				fileUrisWithBreakpoints.add(bp.location.uri.toString());
			}
		}

		// Update all file nodes
		const nodes = this.model.getNodes();
		for (const node of nodes) {
			if (node.uri) {
				const hasBreakpoint = fileUrisWithBreakpoints.has(node.uri);
				if (node.hasBreakpoint !== hasBreakpoint) {
					node.hasBreakpoint = hasBreakpoint;
				}
			}
		}

		// Trigger model update
		this.model.onUpdate(() => {});
	}

	/**
	 * Update active editor flag on nodes
	 */
	private updateActiveEditor(): void {
		const activeEditor = vscode.window.activeTextEditor;
		const activeUri = activeEditor?.document.uri.toString();

		const nodes = this.model.getNodes();
		for (const node of nodes) {
			const wasActive = node.isActive;
			const isActive = node.uri === activeUri;
			
			if (wasActive !== isActive) {
				node.isActive = isActive;
			}
		}

		// Trigger model update
		this.model.onUpdate(() => {});
	}

	/**
	 * Dispose of all listeners
	 */
	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}

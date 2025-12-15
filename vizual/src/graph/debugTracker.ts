import * as vscode from 'vscode';
import { GraphModel } from './model';

/**
 * Debug state tracker for breakpoint highlighting
 */
export class DebugStateTracker {
	private model: GraphModel;
	private disposables: vscode.Disposable[] = [];
	private debugDisposables: vscode.Disposable[] = [];

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

		// Listen for debug session lifecycle
		this.disposables.push(
			vscode.debug.onDidStartDebugSession((session) => {
				this.attachDebugSession(session);
			})
		);

		this.disposables.push(
			vscode.debug.onDidTerminateDebugSession(() => {
				this.clearActiveDebug();
			})
		);

		// Attach to already active session
		if (vscode.debug.activeDebugSession) {
			this.attachDebugSession(vscode.debug.activeDebugSession);
		}

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
		this.model.emitUpdate();
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
		this.model.emitUpdate();
	}

	/**
	 * Attach trackers to a debug session and respond to paused/continued
	 */
	private attachDebugSession(session: vscode.DebugSession): void {
		// Reset previous trackers
		this.debugDisposables.forEach(d => d.dispose());
		this.debugDisposables = [];

		// Track adapter messages to detect 'stopped' and 'continued'
		const trackerFactory: vscode.DebugAdapterTrackerFactory = {
			createDebugAdapterTracker: (_s) => ({
				onDidSendMessage: async (m: any) => {
					try {
						if (m && m.event === 'stopped') {
							await this.updateActiveDebug(session);
						}
						if (m && (m.event === 'continued' || m.event === 'terminated')) {
							this.clearActiveDebug();
						}
					} catch {
						// ignore tracker errors
					}
				}
			})
		};
		const disposable = vscode.debug.registerDebugAdapterTrackerFactory('*', trackerFactory);
		this.debugDisposables.push(disposable);

		// Immediately check if session is already paused (handles race condition)
		// Wait a bit for the adapter to be fully initialized
		setTimeout(() => {
			this.updateActiveDebug(session).catch(() => {
				// Session might not be ready yet, ignore
			});
		}, 100);
	}

	/**
	 * Clear active debug flags on nodes
	 */
	private clearActiveDebug(): void {
		const nodes = this.model.getNodes();
		for (const node of nodes) {
			if (node.isDebugActive) node.isDebugActive = false;
			if (node.isDebugSymbolActive) node.isDebugSymbolActive = false;
		}
		this.model.onUpdate(() => {});
		this.model.emitUpdate();
	}

	/**
	 * Update nodes based on current paused call stack
	 */
	private async updateActiveDebug(session: vscode.DebugSession): Promise<void> {
		// Collect active URIs from stack frames and mark corresponding file nodes
		const fileDepths = new Map<string, number>(); // Track minimum depth per file
		const symbolTargets: Array<{ uri: string; line: number; column?: number; depth: number }> = [];

		try {
			// Get threads
			const threads = await session.customRequest('threads');
			if (threads && threads.threads) {
				for (const t of threads.threads) {
					const stack = await session.customRequest('stackTrace', { threadId: t.id, startFrame: 0, levels: 20 });
					if (stack && stack.stackFrames) {
						for (let i = 0; i < stack.stackFrames.length; i++) {
							const frame = stack.stackFrames[i];
							const src = frame.source;
							const line = frame.line;
							const path = src?.path;
							const uri = src?.uri ?? (path ? vscode.Uri.file(path).toString() : undefined);
							if (uri) {
								// Track minimum depth for this file
								const currentDepth = fileDepths.get(uri);
								if (currentDepth === undefined || i < currentDepth) {
									fileDepths.set(uri, i);
								}
								// Include all call stack frames for symbol highlighting with depth
								symbolTargets.push({ uri, line, column: frame.column, depth: i });
							}
						}
					}
				}
			}
		} catch {
			// If adapter doesn't support custom requests, bail gracefully
		}

		const nodes = this.model.getNodes();
		for (const node of nodes) {
			// File nodes: assign depth from minimum depth in that file
			if (node.uri && fileDepths.has(node.uri)) {
				node.isDebugActive = true;
				// Assign depth to file nodes as well
				if (!node.range) {
					node.debugStackDepth = fileDepths.get(node.uri);
				}
			} else if (node.isDebugActive) {
				node.isDebugActive = false;
				if (!node.range) {
					node.debugStackDepth = undefined;
				}
			}

			// Symbol highlight if paused location is within range
			if (node.range && node.uri) {
				const target = symbolTargets.find(s => s.uri === node.uri && this.containsLine(node.range!, s.line));
				if (target) {
					node.isDebugSymbolActive = true;
					node.debugStackDepth = target.depth;
				} else {
					node.isDebugSymbolActive = false;
					node.debugStackDepth = undefined;
				}
			} else if (node.isDebugSymbolActive) {
				node.isDebugSymbolActive = false;
				node.debugStackDepth = undefined;
			}
		}

		// Log debug state for inspection
		const debugNodes = nodes.filter(n => n.isDebugActive || n.isDebugSymbolActive);
		if (debugNodes.length > 0) {
			console.log(`[Debug] Updated ${debugNodes.length} nodes with debug flags:`, debugNodes.map(n => ({ id: n.id, label: n.label, isDebugActive: n.isDebugActive, isDebugSymbolActive: n.isDebugSymbolActive, debugStackDepth: n.debugStackDepth })));
		}

		this.model.emitUpdate();
	}

	private containsLine(range: vscode.Range, line: number): boolean {
		const start = range.start.line;
		const end = range.end.line;
		return line >= start && line <= end;
	}

	/**
	 * Dispose of all listeners
	 */
	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
		this.debugDisposables.forEach(d => d.dispose());
		this.debugDisposables = [];
	}
}

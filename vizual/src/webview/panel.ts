import * as vscode from 'vscode';
import * as path from 'path';
import { GraphController } from '../graph/controller';
import { EdgeKind, ExtensionMessage, GraphEdge, GraphNode, GraphStats, NodeKind, WebviewMessage } from '../graph/types';

/**
 * Webview panel manager
 */
export class GraphPanel {
	public static currentPanel: GraphPanel | undefined;
	private static readonly codeFileExtensions = new Set<string>([
		'.ts', '.tsx', '.mts', '.cts',
		'.js', '.jsx', '.mjs', '.cjs',
		'.py', '.java', '.cs',
		'.c', '.cc', '.cpp', '.cxx',
		'.h', '.hh', '.hpp', '.hxx',
		'.go', '.rs', '.php', '.rb', '.swift',
		'.kt', '.kts', '.scala', '.lua', '.dart',
		'.json', '.jsonc', '.xml', '.yml', '.yaml',
		'.html', '.htm', '.css', '.scss', '.sass', '.less',
		'.vue', '.svelte', '.sql', '.r'
	]);
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly controller: GraphController;
	private disposables: vscode.Disposable[] = [];
	private readonly lineCountCache = new Map<string, number>();
	private isSendingGraphUpdate = false;
	private pendingGraphUpdate = false;

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		controller: GraphController
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.controller = controller;

		// Set the webview's initial html content
		this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

		// Listen for when the panel is disposed
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Handle messages from the webview
		this.panel.webview.onDidReceiveMessage(
			message => this.handleWebviewMessage(message),
			null,
			this.disposables
		);

		// Subscribe to model updates
		this.disposables.push(
			this.controller.onUpdate(() => {
				void this.sendGraphUpdate();
			})
		);

		this.disposables.push(
			vscode.languages.onDidChangeDiagnostics(event => {
				if (event.uris.length === 0) {
					return;
				}

				const changedUris = new Set(event.uris.map(uri => uri.toString()));
				const hasImpactedNode = this.controller.getModel().getNodes().some(node =>
					!!node.uri && changedUris.has(node.uri)
				);

				if (hasImpactedNode) {
					void this.sendGraphUpdate();
				}
			})
		);

		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(event => {
				const uriKey = event.document.uri.toString();
				this.lineCountCache.delete(uriKey);

				const hasImpactedNode = this.controller.getModel().getNodes().some(node => node.uri === uriKey);
				if (hasImpactedNode) {
					void this.sendGraphUpdate();
				}
			})
		);

		// Initialize the graph
		this.initializeGraph();
	}

	/**
	 * Create or show the panel
	 */
	public static createOrShow(extensionUri: vscode.Uri, rootPath: string): GraphPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it
		if (GraphPanel.currentPanel) {
			GraphPanel.currentPanel.panel.reveal(column);
			return GraphPanel.currentPanel;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'projectGraph',
			'Project Graph',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'media')
				]
			}
		);

		const controller = new GraphController(rootPath);
		GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, controller);
		return GraphPanel.currentPanel;
	}

	/**
	 * Initialize the graph
	 */
	private async initializeGraph(): Promise<void> {
		await this.controller.initialize();
		await this.sendGraphUpdate();
		this.sendStateUpdate();
	}

	/**
	 * Handle messages from webview
	 */
	private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
		switch (message.type) {
			case 'node/expand':
				await this.controller.expandNode(message.nodeId);
				break;

			case 'node/collapse':
				this.controller.collapseNode(message.nodeId);
				break;

			case 'node/open':
				await this.controller.openNode(message.nodeId, message.ctrlKey);
				break;

			case 'node/snippet': {
				const snippet = await this.controller.getNodeSnippet(message.nodeId);
				const snippetMessage: ExtensionMessage = {
					type: 'node/snippet',
					requestId: message.requestId,
					nodeId: message.nodeId,
					lineNumber: snippet?.lineNumber,
					lineTexts: snippet?.lineTexts
				};
				this.panel.webview.postMessage(snippetMessage);
				break;
			}

			case 'filters/set':
				await this.controller.setFilters(message.filters);
				break;

			case 'colors/set':
				this.controller.setColorRules(message.colors);
				break;

			case 'dependencyMode/set':
				this.controller.setDependencyMode(message.value);
				this.sendStateUpdate();
				break;

			case 'root/pick':
				await this.pickNewRoot();
				break;

			case 'activeMode/set':
				this.controller.setActiveMode(message.value);
				break;
		}
	}

	/**
	 * Pick a new root folder
	 */
	private async pickNewRoot(): Promise<void> {
		const result = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			title: 'Select Root Folder for Graph'
		});

		if (result && result[0]) {
			await this.controller.setRootPath(result[0].fsPath);
			this.sendStateUpdate();
			await this.sendGraphUpdate();
		}
	}

	/**
	 * Send graph update to webview
	 */
	private async sendGraphUpdate(): Promise<void> {
		if (this.isSendingGraphUpdate) {
			this.pendingGraphUpdate = true;
			return;
		}

		this.isSendingGraphUpdate = true;
		try {
			do {
				this.pendingGraphUpdate = false;

				const model = this.controller.getModel();
				const diagnosticsCache = new Map<string, { errors: number; warnings: number; isCodeFile: boolean }>();
				const diagnosticsByUri = new Map<string, readonly vscode.Diagnostic[]>();
				const nodes = model.getNodes().map(node => {
					const diagnosticInfo = this.collectDiagnosticInfo(node, diagnosticsCache, diagnosticsByUri);
					return {
						...node,
						diagnosticsErrors: diagnosticInfo.errors,
						diagnosticsWarnings: diagnosticInfo.warnings,
						isCodeFile: diagnosticInfo.isCodeFile
					};
				});
				const edges = model.getEdges();
				const stats = await this.buildGraphStats(nodes, edges);

				const message: ExtensionMessage = {
					type: 'graph/update',
					nodes,
					edges,
					meta: { stats }
				};
				await this.panel.webview.postMessage(message);
			} while (this.pendingGraphUpdate);
		} finally {
			this.isSendingGraphUpdate = false;
		}
	}

	private collectDiagnosticInfo(
		node: GraphNode,
		cache: Map<string, { errors: number; warnings: number; isCodeFile: boolean }>,
		diagnosticsByUri: Map<string, readonly vscode.Diagnostic[]>
	): { errors: number; warnings: number; isCodeFile: boolean } {
		if (!node.uri) {
			return { errors: 0, warnings: 0, isCodeFile: false };
		}

		let uri: vscode.Uri;
		try {
			uri = vscode.Uri.parse(node.uri);
		} catch {
			const fallback = { errors: 0, warnings: 0, isCodeFile: false };
			cache.set(`${node.uri}::invalid`, fallback);
			return fallback;
		}

		const isCodeFile = this.isCodeFileUri(uri);
		const cacheKey = this.getDiagnosticCacheKey(node);
		const cached = cache.get(cacheKey);
		if (cached) {
			return cached;
		}

		let errors = 0;
		let warnings = 0;

		if (isCodeFile) {
			const diagnostics = diagnosticsByUri.get(node.uri) ?? vscode.languages.getDiagnostics(uri);
			diagnosticsByUri.set(node.uri, diagnostics);

			for (const diagnostic of diagnostics) {
				if (node.range && !this.rangesOverlap(node.range, diagnostic.range)) {
					continue;
				}

				if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
					errors += 1;
				} else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
					warnings += 1;
				}
			}
		}

		const info = { errors, warnings, isCodeFile };
		cache.set(cacheKey, info);
		return info;
	}

	private getDiagnosticCacheKey(node: GraphNode): string {
		if (!node.uri) {
			return '__no-uri__';
		}

		if (!node.range) {
			return `${node.uri}::file`;
		}

		const { start, end } = node.range;
		return `${node.uri}::${start.line}:${start.character}-${end.line}:${end.character}`;
	}

	private rangesOverlap(a: vscode.Range, b: vscode.Range): boolean {
		const startsBeforeOtherEnds = a.start.isBeforeOrEqual(b.end);
		const endsAfterOtherStarts = a.end.isAfterOrEqual(b.start);
		return startsBeforeOtherEnds && endsAfterOtherStarts;
	}

	private isCodeFileUri(uri: vscode.Uri): boolean {
		const extension = path.extname(uri.fsPath).toLowerCase();
		return GraphPanel.codeFileExtensions.has(extension);
	}

	private async buildGraphStats(nodes: GraphNode[], edges: GraphEdge[]): Promise<GraphStats> {
		const fileNodes = nodes.filter(node => node.kind === NodeKind.File);
		const codeFileNodes = fileNodes.filter(node => {
			if (!node.uri) {
				return false;
			}

			const uri = this.parseUriSafe(node.uri);
			return !!uri && this.isCodeFileUri(uri);
		});

		let linesOfCode = 0;
		for (const node of codeFileNodes) {
			if (!node.uri) {
				continue;
			}

			const uri = this.parseUriSafe(node.uri);
			if (!uri) {
				continue;
			}

			linesOfCode += await this.countLinesOfCode(uri);
		}

		const dependencyCount = edges.filter(edge =>
			edge.kind === EdgeKind.DependsLocal || edge.kind === EdgeKind.DependsExternal
		).length;

		const errorCount = fileNodes.reduce(
			(sum, node) => sum + (Number.isFinite(node.diagnosticsErrors) ? Math.max(0, node.diagnosticsErrors ?? 0) : 0),
			0
		);

		const warningCount = fileNodes.reduce(
			(sum, node) => sum + (Number.isFinite(node.diagnosticsWarnings) ? Math.max(0, node.diagnosticsWarnings ?? 0) : 0),
			0
		);

		return {
			fileCount: fileNodes.length,
			linesOfCode,
			dependencyCount,
			errorCount,
			warningCount
		};
	}

	private async countLinesOfCode(uri: vscode.Uri): Promise<number> {
		const cacheKey = uri.toString();
		const cached = this.lineCountCache.get(cacheKey);
		if (typeof cached === 'number') {
			return cached;
		}

		try {
			const document = await vscode.workspace.openTextDocument(uri);
			let count = 0;
			for (let i = 0; i < document.lineCount; i++) {
				if (document.lineAt(i).text.trim().length > 0) {
					count += 1;
				}
			}

			this.lineCountCache.set(cacheKey, count);
			return count;
		} catch {
			this.lineCountCache.set(cacheKey, 0);
			return 0;
		}
	}

	private parseUriSafe(rawUri: string): vscode.Uri | undefined {
		try {
			return vscode.Uri.parse(rawUri);
		} catch {
			return undefined;
		}
	}

	/**
	 * Send state update to webview
	 */
	private sendStateUpdate(): void {
		const model = this.controller.getModel();
		const message: ExtensionMessage = {
			type: 'state/update',
			filters: model.getFilters(),
			colors: model.getColorRules(),
			root: model.getState().rootPath,
			activeMode: model.getActiveMode(),
			dependencyMode: model.getDependencyMode()
		};
		this.panel.webview.postMessage(message);
	}

	/**
	 * Get HTML content for the webview
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'media', 'main.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'media', 'style.css')
		);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://unpkg.com;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Project Graph</title>
</head>
<body>
	<header id="toolbar">
		<div class="toolbar-left">
			<div class="toolbar-label">Root</div>
			<div id="root-path" class="toolbar-value"></div>
		</div>
		<div class="toolbar-actions">
			<button id="change-root">Change Root</button>
			<button id="open-settings">Settings</button>
		</div>
	</header>

	<section id="settings-panel" class="panel" data-open="false">
		<div class="panel-header">
			<h3>Settings</h3>
			<button id="close-settings" aria-label="Close settings">×</button>
		</div>
		<div class="panel-content">
			<div class="panel-section">
				<div class="section-title">General</div>
				<label class="inline-row">
					<input type="checkbox" id="active-mode">
					<span>Active Mode</span>
				</label>
				<label class="inline-row">
					<input type="checkbox" id="debug-mode">
					<span>Active Debug Highlight</span>
				</label>
				<label class="inline-row">
					<input type="checkbox" id="dependency-mode">
					<span>Dependency Graph</span>
				</label>
				<label class="inline-row">Depth
					<input type="number" id="animate-depth" min="1" max="12" value="2">
				</label>
				<label>Pop Speed
					<input type="range" id="animate-speed" min="0.5" max="2" step="0.1" value="1">
					<span class="value" id="animate-speed-value">1.0x</span>
				</label>
				<button id="animate-graph">Animate</button>
			</div>

			<div class="panel-section">
				<div class="section-title">Error/Warning Highlighting</div>
				<label class="inline-row">
					<input type="checkbox" id="error-warning-highlighting">
					<span>Enable Diagnostic Coloring</span>
				</label>
				<div class="section-note">Overrides all node colors. Code files and their symbols: error red, warning yellow, clean green. Non-code nodes remain grey.</div>
			</div>

			<div class="panel-section">
				<div class="section-title">Physics</div>
				<label>Center Force
					<input type="range" id="center-force" min="0" max="0.5" step="0.01">
					<span class="value" id="center-force-value"></span>
				</label>
				<label>Link Force
					<input type="range" id="link-force" min="0.01" max="0.3" step="0.01">
					<span class="value" id="link-force-value"></span>
				</label>
				<label>Link Length
					<input type="range" id="link-length" min="50" max="400" step="10">
					<span class="value" id="link-length-value"></span>
				</label>
			</div>

			<div class="panel-section">
				<div class="section-title">Display</div>
				<label>Line Thickness
					<input type="range" id="line-thickness" min="0.5" max="5" step="0.5">
					<span class="value" id="line-thickness-value"></span>
				</label>
			</div>

			<div class="panel-section">
				<div class="section-title">Filters</div>
				<label>Include Patterns (one per line)</label>
				<textarea id="include-patterns" rows="3"></textarea>
				<label>Exclude Patterns (one per line)</label>
				<textarea id="exclude-patterns" rows="4"></textarea>
				<label class="inline-row">Max Depth <input type="number" id="max-depth" min="1" max="100"></label>
				<label class="inline-row">Max Nodes <input type="number" id="max-nodes" min="100" max="10000"></label>
				<button id="apply-filters">Apply Filters</button>
			</div>

			<div class="panel-section">
				<div class="section-title">Colors</div>
				<div id="color-rules"></div>
				<button id="apply-colors">Apply Colors</button>
			</div>
		</div>
	</section>

	<div id="graph-container"></div>
	<div id="stats-panel" data-collapsed="false">
		<div class="stats-header">
			<span>Workspace Stats</span>
			<button id="stats-toggle" aria-label="Minimize stats">−</button>
		</div>
		<div class="stats-content">
			<div class="stats-row"><span>Files</span><strong id="stats-files">0</strong></div>
			<div class="stats-row"><span>LOC (code)</span><strong id="stats-loc">0</strong></div>
			<div class="stats-row"><span>Dependencies</span><strong id="stats-deps">0</strong></div>
			<div class="stats-row"><span>Errors</span><strong id="stats-errors">0</strong></div>
			<div class="stats-row"><span>Warnings</span><strong id="stats-warnings">0</strong></div>
		</div>
	</div>
	<div id="animation-status" aria-live="polite"></div>

	<script src="https://unpkg.com/vis-network@9.1.2/dist/vis-network.min.js"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		GraphPanel.currentPanel = undefined;

		this.panel.dispose();
		this.controller.dispose();

		while (this.disposables.length) {
			const disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

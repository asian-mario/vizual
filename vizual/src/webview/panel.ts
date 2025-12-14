import * as vscode from 'vscode';
import * as path from 'path';
import { GraphController } from '../graph/controller';
import { ExtensionMessage, WebviewMessage } from '../graph/types';

/**
 * Webview panel manager
 */
export class GraphPanel {
	public static currentPanel: GraphPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly controller: GraphController;
	private disposables: vscode.Disposable[] = [];

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
				this.sendGraphUpdate();
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
					vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'media')
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
		this.sendGraphUpdate();
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

			case 'filters/set':
				this.controller.setFilters(message.filters);
				break;

			case 'colors/set':
				this.controller.setColorRules(message.colors);
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
		}
	}

	/**
	 * Send graph update to webview
	 */
	private sendGraphUpdate(): void {
		const model = this.controller.getModel();
		const message: ExtensionMessage = {
			type: 'graph/update',
			nodes: model.getNodes(),
			edges: model.getEdges(),
			meta: {}
		};
		this.panel.webview.postMessage(message);
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
			activeMode: model.getActiveMode()
		};
		this.panel.webview.postMessage(message);
	}

	/**
	 * Get HTML content for the webview
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media', 'main.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media', 'style.css')
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

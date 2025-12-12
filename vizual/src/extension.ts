// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GraphPanel } from './webview/panel';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Vizual extension is now active!');

	// Register the command to open the project graph
	const openGraphCommand = vscode.commands.registerCommand('projectGraph.openGraph', () => {
		// Get the workspace root path
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		GraphPanel.createOrShow(context.extensionUri, rootPath);
	});

	context.subscriptions.push(openGraphCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}

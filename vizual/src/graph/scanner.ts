import * as vscode from 'vscode';
import * as path from 'path';
import { GraphModel } from './model';
import { GraphNode, NodeKind, FilterConfig } from './types';
import { minimatch } from 'minimatch';

/**
 * Filesystem scanner for incremental graph building
 */
export class FileSystemScanner {
	private model: GraphModel;

	constructor(model: GraphModel) {
		this.model = model;
	}

	/**
	 * Initialize root node
	 */
	async initializeRoot(): Promise<void> {
		const rootPath = this.model.getState().rootPath;
		const rootUri = vscode.Uri.file(rootPath);
		const rootName = path.basename(rootPath);

		const rootNode: GraphNode = {
			id: rootUri.toString(),
			label: rootName,
			kind: NodeKind.Folder,
			uri: rootUri.toString(),
			isExpanded: false,
			isLeaf: false
		};

		this.model.addNode(rootNode);
	}

	/**
	 * Expand a folder node to show its children
	 */
	async expandFolder(nodeId: string): Promise<void> {
		const node = this.model.getNode(nodeId);
		if (!node || node.kind !== NodeKind.Folder) {
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

		const folderUri = vscode.Uri.parse(node.uri!);
		const filters = this.model.getFilters();

		try {
			const entries = await vscode.workspace.fs.readDirectory(folderUri);

			for (const [name, fileType] of entries) {
				const childUri = vscode.Uri.joinPath(folderUri, name);
				const relativePath = vscode.workspace.asRelativePath(childUri);
				const isDirectory = fileType === vscode.FileType.Directory;

				// Apply filters
				if (!this.shouldInclude(relativePath, isDirectory, filters)) {
					continue;
				}

				const childNode: GraphNode = {
					id: childUri.toString(),
					label: name,
					kind: isDirectory ? NodeKind.Folder : NodeKind.File,
					uri: childUri.toString(),
					isExpanded: false,
					isLeaf: !isDirectory
				};

				this.model.addNode(childNode);
				this.model.addEdge(nodeId, childNode.id);

				// Stop if we hit the limit
				if (this.model.isOverNodeLimit()) {
					break;
				}
			}

			// Mark node as expanded
			this.model.setNodeExpanded(nodeId, true);

		} catch (error) {
			console.error('Error expanding folder:', error);
			vscode.window.showErrorMessage(`Failed to expand folder: ${error}`);
		}
	}

	/**
	 * Check if a path should be included based on filters
	 */
	private shouldInclude(relativePath: string, isDirectory: boolean, filters: FilterConfig): boolean {
		const normalizedPath = relativePath.replace(/\\/g, '/');
		const directoryPath = isDirectory ? `${normalizedPath}/` : normalizedPath;
		const minimatchOptions = { dot: true, nocase: process.platform === 'win32' };

		// Check exclude patterns
		for (const pattern of filters.excludePatterns) {
			if (
				minimatch(normalizedPath, pattern, minimatchOptions) ||
				(isDirectory && minimatch(directoryPath, pattern, minimatchOptions))
			) {
				return false;
			}
		}

		// Always keep traversing non-excluded directories so file globs work deeply.
		if (isDirectory) {
			return true;
		}

		if (!filters.includePatterns || filters.includePatterns.length === 0) {
			return true;
		}

		// Check include patterns
		for (const pattern of filters.includePatterns) {
			if (minimatch(normalizedPath, pattern, minimatchOptions)) {
				return true;
			}
		}

		return false;
	}
}

import * as vscode from 'vscode';
import * as path from 'path';
import { GraphModel } from './model';
import { FileSystemScanner } from './scanner';
import { SymbolProvider } from './symbolProvider';
import { DebugStateTracker } from './debugTracker';
import { NodeKind, EdgeKind, FilterConfig, ColorRule, GraphNode } from './types';

interface ParsedDependency {
	specifier: string;
	isLocal: boolean;
}

/**
 * Main graph controller that coordinates all components
 */
export class GraphController {
	private static readonly dependencySourceExtensions = new Set<string>([
		'.ts', '.tsx', '.mts', '.cts',
		'.js', '.jsx', '.mjs', '.cjs',
		'.py', '.java', '.go', '.rs',
		'.php', '.rb', '.swift', '.kt', '.kts', '.scala', '.dart'
	]);

	private static readonly localDependencyResolveExtensions = [
		'.ts', '.tsx', '.mts', '.cts',
		'.js', '.jsx', '.mjs', '.cjs',
		'.py', '.json', '.jsonc',
		'.go', '.rs', '.java',
		'.php', '.rb', '.swift', '.kt', '.kts', '.scala', '.dart',
		'.css', '.scss', '.sass', '.less', '.html', '.vue', '.svelte'
	];

	private model: GraphModel;
	private scanner: FileSystemScanner;
	private symbolProvider: SymbolProvider;
	private debugTracker: DebugStateTracker;
	private dependencyRefreshVersion = 0;

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

		if (this.model.getDependencyMode()) {
			await this.refreshDependencyGraph();
		}
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

		if (this.model.getDependencyMode()) {
			await this.refreshDependencyGraph();
		}
	}

	/**
	 * Collapse a node (remove its children)
	 */
	collapseNode(nodeId: string): void {
		this.model.collapseNode(nodeId);

		if (this.model.getDependencyMode()) {
			void this.refreshDependencyGraph();
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
	 * Resolve a short code snippet (first 4 lines) for a node (if it points to source)
	 */
	async getNodeSnippet(nodeId: string): Promise<{ lineNumber: number; lineTexts: string[] } | undefined> {
		const node = this.model.getNode(nodeId);
		if (!node || !node.uri || !node.range) {
			return undefined;
		}

		try {
			const uri = vscode.Uri.parse(node.uri);
			const document = await vscode.workspace.openTextDocument(uri);
			const lineIndex = node.range.start.line;
			if (lineIndex < 0 || lineIndex >= document.lineCount) {
				return undefined;
			}

			const endIndex = Math.min(lineIndex + 4, document.lineCount);
			const lineTexts: string[] = [];
			for (let i = lineIndex; i < endIndex; i++) {
				const rawLine = document.lineAt(i).text;
				lineTexts.push(rawLine.length > 0 ? rawLine : '<empty line>');
			}

			return {
				lineNumber: lineIndex + 1,
				lineTexts
			};
		} catch {
			return undefined;
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
	async setFilters(filters: Partial<FilterConfig>): Promise<void> {
		this.model.setFilters(filters);
		this.model.clear();
		await this.scanner.initializeRoot();

		if (this.model.getDependencyMode()) {
			await this.refreshDependencyGraph();
		}
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
	 * Set dependency mode
	 */
	setDependencyMode(value: boolean): void {
		if (this.model.getDependencyMode() === value) {
			return;
		}

		this.dependencyRefreshVersion += 1;
		this.model.setDependencyMode(value);

		if (!value) {
			this.clearDependencyGraph();
			return;
		}

		void this.refreshDependencyGraph();
	}

	private clearDependencyGraph(): void {
		this.model.removeEdgesByKinds([EdgeKind.DependsLocal, EdgeKind.DependsExternal]);
		this.model.removeNodesByPredicate(node => {
			if (node.kind === NodeKind.Dependency) {
				return true;
			}

			return Boolean(node.metadata?.dependencyVirtual);
		});
	}

	private async refreshDependencyGraph(): Promise<void> {
		const refreshVersion = ++this.dependencyRefreshVersion;

		if (!this.model.getDependencyMode()) {
			return;
		}

		this.clearDependencyGraph();

		const fileNodes = this.model.getNodes().filter(node =>
			node.kind === NodeKind.File &&
			node.uri &&
			this.isDependencySourceFile(node.uri)
		);

		if (!fileNodes.length) {
			return;
		}

		const fileNodeByPath = new Map<string, GraphNode>();
		for (const fileNode of fileNodes) {
			try {
				const fileUri = vscode.Uri.parse(fileNode.uri!);
				fileNodeByPath.set(this.normalizeFsPath(fileUri.fsPath), fileNode);
			} catch {
				// Ignore invalid URIs
			}
		}

		const dependencyNodes = new Set<string>();

		for (const sourceNode of fileNodes) {
			if (!this.model.getDependencyMode() || refreshVersion !== this.dependencyRefreshVersion) {
				return;
			}

			if (!sourceNode.uri) {
				continue;
			}

			let sourceUri: vscode.Uri;
			try {
				sourceUri = vscode.Uri.parse(sourceNode.uri);
			} catch {
				continue;
			}

			const dependencies = await this.extractDependencies(sourceUri);
			for (const dependency of dependencies) {
				if (!this.model.getDependencyMode() || refreshVersion !== this.dependencyRefreshVersion) {
					return;
				}

				if (dependency.isLocal) {
					const targetUri = await this.resolveLocalDependencyUri(sourceUri, dependency.specifier);
					if (!targetUri) {
						const unresolvedNodeId = `dependency:local-unresolved:${dependency.specifier}`;
						if (!dependencyNodes.has(unresolvedNodeId)) {
							dependencyNodes.add(unresolvedNodeId);
							this.model.addNode({
								id: unresolvedNodeId,
								label: dependency.specifier,
								kind: NodeKind.Dependency,
								isExpanded: false,
								isLeaf: true,
								metadata: {
									dependencyVirtual: true,
									note: 'Local dependency could not be resolved to a workspace source file.'
								}
							});
						}

						this.model.addEdge(sourceNode.id, unresolvedNodeId, EdgeKind.DependsLocal);
						continue;
					}

					const normalizedTargetPath = this.normalizeFsPath(targetUri.fsPath);
					let targetNode = fileNodeByPath.get(normalizedTargetPath);

					if (!targetNode) {
						targetNode = {
							id: targetUri.toString(),
							label: path.basename(targetUri.fsPath),
							kind: NodeKind.File,
							uri: targetUri.toString(),
							isExpanded: false,
							isLeaf: false,
							metadata: {
								dependencyVirtual: true,
								dependencyOrigin: 'local'
							}
						};

						this.model.addNode(targetNode);
						fileNodeByPath.set(normalizedTargetPath, targetNode);
					}

					if (sourceNode.id !== targetNode.id) {
						this.model.addEdge(sourceNode.id, targetNode.id, EdgeKind.DependsLocal);
					}
					continue;
				}

				const externalNodeId = `dependency:external:${dependency.specifier}`;
				if (!dependencyNodes.has(externalNodeId)) {
					dependencyNodes.add(externalNodeId);
					this.model.addNode({
						id: externalNodeId,
						label: dependency.specifier,
						kind: NodeKind.Dependency,
						isExpanded: false,
						isLeaf: true,
						metadata: {
							dependencyVirtual: true,
							note: 'Dependency source file is not inside the workspace or could not be resolved.'
						}
					});
				}

				this.model.addEdge(sourceNode.id, externalNodeId, EdgeKind.DependsExternal);
			}
		}
	}

	private isDependencySourceFile(uri: string): boolean {
		try {
			const parsed = vscode.Uri.parse(uri);
			const extension = path.extname(parsed.fsPath).toLowerCase();
			return GraphController.dependencySourceExtensions.has(extension);
		} catch {
			return false;
		}
	}

	private async extractDependencies(sourceUri: vscode.Uri): Promise<ParsedDependency[]> {
		let text = '';
		const sourceExtension = path.extname(sourceUri.fsPath).toLowerCase();
		try {
			const document = await vscode.workspace.openTextDocument(sourceUri);
			text = document.getText();
		} catch {
			return [];
		}

		const dependencySpecifiers = new Set<string>();

		const collectMatches = (regex: RegExp, normalizer?: (raw: string) => string[]) => {
			for (const match of text.matchAll(regex)) {
				const raw = (match[1] || '').trim();
				if (!raw) {
					continue;
				}

				const values = normalizer ? normalizer(raw) : [raw];
				for (const value of values) {
					const normalized = value.trim();
					if (!normalized || normalized.startsWith('node:')) {
						continue;
					}
					dependencySpecifiers.add(normalized);
				}
			}
		};

		collectMatches(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?["']([^"']+)["']/g);
		collectMatches(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g);
		collectMatches(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
		collectMatches(/^\s*from\s+([\.\w]+)\s+import\s+/gm);
		collectMatches(/^\s*import\s+([^\n#;]+)$/gm, raw =>
			raw
				.split(',')
				.map(part => part.trim().split(/\s+as\s+/i)[0].trim())
				.filter(part => {
					if (!part) {
						return false;
					}

					if (part.includes('"') || part.includes("'")) {
						return false;
					}

					return !/\bfrom\b/i.test(part);
				})
		);

		if (sourceExtension === '.rs') {
			collectMatches(/^\s*(?:pub\s+)?use\s+([^;]+);/gm, raw => this.normalizeRustUseSpecifiers(raw));
			collectMatches(/^\s*(?:pub\s+)?extern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)/gm);
			collectMatches(/^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm, raw => [`./${raw}`]);
		}

		return Array.from(dependencySpecifiers).map(specifier => ({
			specifier,
			isLocal:
				specifier.startsWith('.') ||
				specifier.startsWith('/') ||
				specifier === 'crate' ||
				specifier.startsWith('crate::') ||
				specifier === 'self' ||
				specifier.startsWith('self::') ||
				specifier === 'super' ||
				specifier.startsWith('super::')
		}));
	}

	private async resolveLocalDependencyUri(sourceUri: vscode.Uri, specifier: string): Promise<vscode.Uri | undefined> {
		if (path.extname(sourceUri.fsPath).toLowerCase() === '.rs') {
			const rustResolved = await this.resolveRustDependencyUri(sourceUri, specifier);
			if (rustResolved) {
				return rustResolved;
			}
		}

		const sourceDir = path.dirname(sourceUri.fsPath);
		const rawTargetPath = specifier.startsWith('/')
			? path.resolve(this.model.getState().rootPath, `.${specifier}`)
			: path.resolve(sourceDir, specifier);

		const candidates = new Set<string>();
		candidates.add(rawTargetPath);

		const currentExtension = path.extname(rawTargetPath);
		if (!currentExtension) {
			for (const extension of GraphController.localDependencyResolveExtensions) {
				candidates.add(`${rawTargetPath}${extension}`);
				candidates.add(path.join(rawTargetPath, `index${extension}`));
			}
		}

		for (const candidate of candidates) {
			if (await this.pathExists(candidate)) {
				return vscode.Uri.file(candidate);
			}
		}

		return undefined;
	}

	private normalizeRustUseSpecifiers(raw: string): string[] {
		const cleaned = raw
			.replace(/\s+/g, ' ')
			.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*/g, '')
			.trim();

		if (!cleaned) {
			return [];
		}

		const result = new Set<string>();
		const expand = (value: string): void => {
			const trimmed = value.trim().replace(/^::/, '').replace(/::\*$/, '');
			if (!trimmed) {
				return;
			}

			const openBraceIndex = trimmed.indexOf('{');
			if (openBraceIndex === -1) {
				result.add(trimmed.replace(/::$/, ''));
				return;
			}

			const closeBraceIndex = trimmed.lastIndexOf('}');
			if (closeBraceIndex === -1 || closeBraceIndex <= openBraceIndex) {
				result.add(trimmed.replace(/::$/, ''));
				return;
			}

			const rawPrefix = trimmed.slice(0, openBraceIndex).replace(/::$/, '').trim();
			const inside = trimmed.slice(openBraceIndex + 1, closeBraceIndex);
			const members = this.splitTopLevelComma(inside);
			for (const memberRaw of members) {
				const member = memberRaw.trim();
				if (!member) {
					continue;
				}

				if (member === 'self') {
					if (rawPrefix) {
						result.add(rawPrefix);
					}
					continue;
				}

				const joined = rawPrefix ? `${rawPrefix}::${member}` : member;
				expand(joined);
			}
		};

		expand(cleaned);
		return Array.from(result).filter(Boolean);
	}

	private splitTopLevelComma(text: string): string[] {
		const parts: string[] = [];
		let depth = 0;
		let token = '';

		for (const char of text) {
			if (char === '{') {
				depth += 1;
			}
			if (char === '}') {
				depth = Math.max(0, depth - 1);
			}

			if (char === ',' && depth === 0) {
				parts.push(token);
				token = '';
				continue;
			}

			token += char;
		}

		if (token.trim()) {
			parts.push(token);
		}

		return parts;
	}

	private async resolveRustDependencyUri(sourceUri: vscode.Uri, specifier: string): Promise<vscode.Uri | undefined> {
		const sourceDir = path.dirname(sourceUri.fsPath);
		const normalized = specifier.trim().replace(/^::/, '');

		if (!normalized) {
			return undefined;
		}

		if (normalized.startsWith('.')) {
			const basePath = path.resolve(sourceDir, normalized);
			return this.resolveRustModuleFromBasePath(basePath);
		}

		if (normalized.startsWith('/')) {
			const crateRoot = await this.findRustCrateSrcRoot(sourceDir);
			const segments = normalized.replace(/^\/+/, '').split('/').filter(Boolean);
			return this.resolveRustModuleFromSegments(crateRoot, segments);
		}

		if (normalized === 'crate' || normalized.startsWith('crate::')) {
			const crateRoot = await this.findRustCrateSrcRoot(sourceDir);
			const modulePath = normalized === 'crate' ? '' : normalized.slice('crate::'.length);
			const segments = modulePath.split('::').filter(Boolean);
			return this.resolveRustModuleFromSegments(crateRoot, segments);
		}

		if (normalized === 'self' || normalized.startsWith('self::')) {
			const modulePath = normalized === 'self' ? '' : normalized.slice('self::'.length);
			const segments = modulePath.split('::').filter(Boolean);
			return this.resolveRustModuleFromSegments(sourceDir, segments);
		}

		if (normalized === 'super' || normalized.startsWith('super::')) {
			let parentDir = sourceDir;
			let remaining = normalized;

			while (remaining.startsWith('super::')) {
				remaining = remaining.slice('super::'.length);
				parentDir = path.dirname(parentDir);
			}

			if (remaining === 'super') {
				remaining = '';
				parentDir = path.dirname(parentDir);
			}

			const segments = remaining.split('::').filter(Boolean);
			return this.resolveRustModuleFromSegments(parentDir, segments);
		}

		return undefined;
	}

	private async resolveRustModuleFromSegments(baseDir: string, segments: string[]): Promise<vscode.Uri | undefined> {
		if (!segments.length) {
			const rootCandidates = [
				path.join(baseDir, 'lib.rs'),
				path.join(baseDir, 'main.rs'),
				path.join(baseDir, 'mod.rs')
			];

			for (const candidate of rootCandidates) {
				if (await this.pathExists(candidate)) {
					return vscode.Uri.file(candidate);
				}
			}

			return undefined;
		}

		for (let length = segments.length; length >= 1; length--) {
			const moduleBasePath = path.join(baseDir, ...segments.slice(0, length));
			const resolved = await this.resolveRustModuleFromBasePath(moduleBasePath);
			if (resolved) {
				return resolved;
			}
		}

		return undefined;
	}

	private async resolveRustModuleFromBasePath(moduleBasePath: string): Promise<vscode.Uri | undefined> {
		const extension = path.extname(moduleBasePath).toLowerCase();
		const candidates = new Set<string>();

		if (extension === '.rs') {
			candidates.add(moduleBasePath);
		} else {
			candidates.add(`${moduleBasePath}.rs`);
			candidates.add(path.join(moduleBasePath, 'mod.rs'));
		}

		for (const candidate of candidates) {
			if (await this.pathExists(candidate)) {
				return vscode.Uri.file(candidate);
			}
		}

		return undefined;
	}

	private async findRustCrateSrcRoot(startDir: string): Promise<string> {
		const cargoRoot = await this.findNearestCargoRoot(startDir);
		if (cargoRoot) {
			return path.join(cargoRoot, 'src');
		}

		const workspaceSrc = path.join(this.model.getState().rootPath, 'src');
		return workspaceSrc;
	}

	private async findNearestCargoRoot(startDir: string): Promise<string | undefined> {
		const normalizedWorkspaceRoot = this.normalizeFsPath(this.model.getState().rootPath);
		let current = path.resolve(startDir);

		while (true) {
			const currentNormalized = this.normalizeFsPath(current);
			if (!currentNormalized.startsWith(normalizedWorkspaceRoot)) {
				return undefined;
			}

			const cargoTomlPath = path.join(current, 'Cargo.toml');
			if (await this.pathExists(cargoTomlPath)) {
				return current;
			}

			const parent = path.dirname(current);
			if (parent === current) {
				break;
			}

			current = parent;
		}

		return undefined;
	}

	private async pathExists(candidatePath: string): Promise<boolean> {
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
			return stat.type === vscode.FileType.File;
		} catch {
			return false;
		}
	}

	private normalizeFsPath(fsPath: string): string {
		return path.normalize(fsPath).toLowerCase();
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

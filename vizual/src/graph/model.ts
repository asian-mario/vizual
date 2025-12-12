import * as vscode from 'vscode';
import { GraphNode, GraphEdge, GraphState, NodeKind, EdgeKind, FilterConfig, ColorRule } from './types';

/**
 * Default filter configuration
 */
export const DEFAULT_FILTERS: FilterConfig = {
	includePatterns: ['**/*'],
	excludePatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/*.map'],
	maxDepth: 10,
	maxNodes: 1000
};

/**
 * Default color rules
 */
export const DEFAULT_COLOR_RULES: ColorRule[] = [
	{ kind: NodeKind.Folder, color: '#FFD700' },
	{ kind: NodeKind.File, color: '#87CEEB' },
	{ kind: NodeKind.Class, color: '#98FB98' },
	{ kind: NodeKind.Function, color: '#DDA0DD' },
	{ kind: NodeKind.Method, color: '#F0E68C' },
	{ kind: NodeKind.Variable, color: '#FFA07A' },
	{ kind: NodeKind.Interface, color: '#B0E0E6' },
	{ kind: NodeKind.Enum, color: '#FFB6C1' }
];

/**
 * Graph model manager
 */
export class GraphModel {
	private state: GraphState;
	private onUpdateCallbacks: Array<() => void> = [];

	constructor(rootPath: string) {
		this.state = {
			nodes: new Map(),
			edges: new Map(),
			rootPath,
			filters: { ...DEFAULT_FILTERS },
			colorRules: [...DEFAULT_COLOR_RULES],
			activeMode: false
		};
	}

	/**
	 * Get current state
	 */
	getState(): GraphState {
		return this.state;
	}

	/**
	 * Set root path
	 */
	setRootPath(path: string): void {
		this.state.rootPath = path;
		this.clear();
		this.notifyUpdate();
	}

	/**
	 * Add or update a node
	 */
	addNode(node: GraphNode): void {
		this.state.nodes.set(node.id, node);
		this.notifyUpdate();
	}

	/**
	 * Get a node by ID
	 */
	getNode(id: string): GraphNode | undefined {
		return this.state.nodes.get(id);
	}

	/**
	 * Add an edge
	 */
	addEdge(from: string, to: string, kind: EdgeKind = EdgeKind.Contains): void {
		const id = `${from}->${to}`;
		this.state.edges.set(id, { id, from, to, kind });
		this.notifyUpdate();
	}

	/**
	 * Get all nodes
	 */
	getNodes(): GraphNode[] {
		return Array.from(this.state.nodes.values());
	}

	/**
	 * Get all edges
	 */
	getEdges(): GraphEdge[] {
		return Array.from(this.state.edges.values());
	}

	/**
	 * Update filters
	 */
	setFilters(filters: Partial<FilterConfig>): void {
		this.state.filters = { ...this.state.filters, ...filters };
		this.notifyUpdate();
	}

	/**
	 * Get filters
	 */
	getFilters(): FilterConfig {
		return this.state.filters;
	}

	/**
	 * Set color rules
	 */
	setColorRules(rules: ColorRule[]): void {
		this.state.colorRules = rules;
		this.notifyUpdate();
	}

	/**
	 * Get color rules
	 */
	getColorRules(): ColorRule[] {
		return this.state.colorRules;
	}

	/**
	 * Set active mode
	 */
	setActiveMode(value: boolean): void {
		this.state.activeMode = value;
		this.notifyUpdate();
	}

	/**
	 * Get active mode
	 */
	getActiveMode(): boolean {
		return this.state.activeMode;
	}

	/**
	 * Mark a node as expanded
	 */
	setNodeExpanded(nodeId: string, expanded: boolean): void {
		const node = this.state.nodes.get(nodeId);
		if (node) {
			node.isExpanded = expanded;
			this.notifyUpdate();
		}
	}

	/**
	 * Check if node count exceeds max
	 */
	isOverNodeLimit(): boolean {
		return this.state.nodes.size >= this.state.filters.maxNodes;
	}

	/**
	 * Clear all nodes and edges
	 */
	clear(): void {
		this.state.nodes.clear();
		this.state.edges.clear();
		this.notifyUpdate();
	}

	/**
	 * Subscribe to updates
	 */
	onUpdate(callback: () => void): vscode.Disposable {
		this.onUpdateCallbacks.push(callback);
		return new vscode.Disposable(() => {
			const index = this.onUpdateCallbacks.indexOf(callback);
			if (index > -1) {
				this.onUpdateCallbacks.splice(index, 1);
			}
		});
	}

	/**
	 * Notify all listeners of update
	 */
	private notifyUpdate(): void {
		this.onUpdateCallbacks.forEach(cb => cb());
	}
}

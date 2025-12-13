import * as vscode from 'vscode';

/**
 * Node kinds in the graph
 */
export enum NodeKind {
	Folder = 'folder',
	File = 'file',
	Class = 'class',
	Function = 'function',
	Method = 'method',
	Variable = 'variable',
	Interface = 'interface',
	Enum = 'enum',
	Namespace = 'namespace',
	Property = 'property',
	Constant = 'constant',
	Constructor = 'constructor',
	Unknown = 'unknown'
}

/**
 * Edge types
 */
export enum EdgeKind {
	Contains = 'contains'
}

/**
 * Graph node representation
 */
export interface GraphNode {
	id: string;
	label: string;
	kind: NodeKind;
	uri?: string;
	range?: vscode.Range;
	isExpanded: boolean;
	isLeaf: boolean;
	hasBreakpoint?: boolean;
	isActive?: boolean;
	metadata?: Record<string, any>;
}

/**
 * Graph edge representation
 */
export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	kind: EdgeKind;
}

/**
 * Filter configuration
 */
export interface FilterConfig {
	includePatterns: string[];
	excludePatterns: string[];
	maxDepth: number;
	maxNodes: number;
}

/**
 * Color rule configuration
 */
export interface ColorRule {
	kind?: NodeKind;
	fileExtension?: string;
	color: string;
}

/**
 * Graph state
 */
export interface GraphState {
	nodes: Map<string, GraphNode>;
	edges: Map<string, GraphEdge>;
	rootPath: string;
	filters: FilterConfig;
	colorRules: ColorRule[];
	activeMode: boolean;
}

/**
 * Messages from extension to webview
 */
export type ExtensionMessage =
	| { type: 'graph/update'; nodes: GraphNode[]; edges: GraphEdge[]; meta: any }
	| { type: 'state/update'; filters: FilterConfig; colors: ColorRule[]; root: string; activeMode: boolean };

/**
 * Messages from webview to extension
 */
export type WebviewMessage =
	| { type: 'node/expand'; nodeId: string }
	| { type: 'node/collapse'; nodeId: string }
	| { type: 'node/open'; nodeId: string; ctrlKey: boolean }
	| { type: 'filters/set'; filters: FilterConfig }
	| { type: 'colors/set'; colors: ColorRule[] }
	| { type: 'root/pick' }
	| { type: 'activeMode/set'; value: boolean };

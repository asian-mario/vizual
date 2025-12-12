(function () {
	const vscode = acquireVsCodeApi();
	let network = null;
	let currentState = {
		filters: null,
		colors: null,
		root: '',
		activeMode: false
	};

	// Initialize UI
	document.addEventListener('DOMContentLoaded', () => {
		initializeEventListeners();
	});

	/**
	 * Initialize event listeners
	 */
	function initializeEventListeners() {
		// Change root button
		document.getElementById('change-root')?.addEventListener('click', () => {
			vscode.postMessage({ type: 'root/pick' });
		});

		// Active mode toggle
		document.getElementById('active-mode')?.addEventListener('change', (e) => {
			vscode.postMessage({ 
				type: 'activeMode/set', 
				value: e.target.checked 
			});
		});

		// Filter panel toggle
		document.getElementById('toggle-filters')?.addEventListener('click', () => {
			const panel = document.getElementById('filters-panel');
			if (panel) {
				panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
			}
		});

		// Color panel toggle
		document.getElementById('toggle-colors')?.addEventListener('click', () => {
			const panel = document.getElementById('colors-panel');
			if (panel) {
				panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
			}
		});

		// Apply filters
		document.getElementById('apply-filters')?.addEventListener('click', () => {
			const includePatterns = document.getElementById('include-patterns').value
				.split('\n')
				.filter(p => p.trim());
			const excludePatterns = document.getElementById('exclude-patterns').value
				.split('\n')
				.filter(p => p.trim());
			const maxDepth = parseInt(document.getElementById('max-depth').value) || 10;
			const maxNodes = parseInt(document.getElementById('max-nodes').value) || 1000;

			vscode.postMessage({
				type: 'filters/set',
				filters: {
					includePatterns,
					excludePatterns,
					maxDepth,
					maxNodes
				}
			});
		});

		// Apply colors (stub for now - would iterate color rules)
		document.getElementById('apply-colors')?.addEventListener('click', () => {
			// Collect color rules from UI and send
			const colorRules = currentState.colors || [];
			vscode.postMessage({
				type: 'colors/set',
				colors: colorRules
			});
		});
	}

	/**
	 * Handle messages from extension
	 */
	window.addEventListener('message', event => {
		const message = event.data;

		switch (message.type) {
			case 'graph/update':
				updateGraph(message.nodes, message.edges);
				break;

			case 'state/update':
				updateState(message);
				break;
		}
	});

	/**
	 * Update graph visualization
	 */
	function updateGraph(nodes, edges) {
		const container = document.getElementById('graph-container');
		if (!container) return;

		// Transform nodes for vis-network
		const visNodes = nodes.map(node => {
			let color = getColorForNode(node);
			
			// Apply active mode dimming
			if (currentState.activeMode) {
				if (!node.isActive && !node.hasBreakpoint) {
					color = '#666666';
				}
			}

			// Highlight breakpoints
			if (node.hasBreakpoint) {
				color = '#ff0000';
			}

			// Highlight active
			if (node.isActive) {
				color = '#00ff00';
			}

			return {
				id: node.id,
				label: node.label,
				color: color,
				shape: getShapeForKind(node.kind),
				font: { color: '#ffffff' }
			};
		});

		// Transform edges for vis-network
		const visEdges = edges.map(edge => ({
			from: edge.from,
			to: edge.to,
			arrows: 'to'
		}));

		const data = {
			nodes: new vis.DataSet(visNodes),
			edges: new vis.DataSet(visEdges)
		};

		const options = {
			layout: {
				hierarchical: {
					direction: 'UD',
					sortMethod: 'directed',
					nodeSpacing: 150,
					levelSeparation: 100
				}
			},
			physics: {
				enabled: false
			},
			interaction: {
				hover: true
			},
			nodes: {
				borderWidth: 2,
				borderWidthSelected: 3,
				font: {
					size: 14,
					color: '#ffffff'
				}
			},
			edges: {
				color: {
					color: '#848484',
					highlight: '#ffffff'
				},
				width: 2
			}
		};

		// Create or update network
		if (!network) {
			network = new vis.Network(container, data, options);

			// Handle node clicks
			network.on('click', (params) => {
				if (params.nodes.length > 0) {
					const nodeId = params.nodes[0];
					const isCtrlPressed = params.event.srcEvent.ctrlKey || params.event.srcEvent.metaKey;

					if (isCtrlPressed) {
						vscode.postMessage({
							type: 'node/open',
							nodeId: nodeId,
							ctrlKey: true
						});
					} else {
						vscode.postMessage({
							type: 'node/expand',
							nodeId: nodeId
						});
					}
				}
			});
		} else {
			network.setData(data);
		}
	}

	/**
	 * Update state UI
	 */
	function updateState(state) {
		currentState = state;

		// Update root path display
		const rootPathEl = document.getElementById('root-path');
		if (rootPathEl) {
			rootPathEl.textContent = state.root;
		}

		// Update active mode checkbox
		const activeModeEl = document.getElementById('active-mode');
		if (activeModeEl) {
			activeModeEl.checked = state.activeMode;
		}

		// Update filter fields
		if (state.filters) {
			const includeEl = document.getElementById('include-patterns');
			const excludeEl = document.getElementById('exclude-patterns');
			const maxDepthEl = document.getElementById('max-depth');
			const maxNodesEl = document.getElementById('max-nodes');

			if (includeEl) includeEl.value = state.filters.includePatterns.join('\n');
			if (excludeEl) excludeEl.value = state.filters.excludePatterns.join('\n');
			if (maxDepthEl) maxDepthEl.value = state.filters.maxDepth;
			if (maxNodesEl) maxNodesEl.value = state.filters.maxNodes;
		}

		// Update color rules
		if (state.colors) {
			renderColorRules(state.colors);
		}
	}

	/**
	 * Render color rules UI
	 */
	function renderColorRules(colors) {
		const container = document.getElementById('color-rules');
		if (!container) return;

		container.innerHTML = '';
		colors.forEach((rule, index) => {
			const div = document.createElement('div');
			div.className = 'color-rule-item';
			
			const label = document.createElement('span');
			label.textContent = rule.kind || rule.fileExtension || 'Unknown';
			
			const colorInput = document.createElement('input');
			colorInput.type = 'color';
			colorInput.value = rule.color;
			colorInput.addEventListener('change', (e) => {
				colors[index].color = e.target.value;
			});

			div.appendChild(label);
			div.appendChild(colorInput);
			container.appendChild(div);
		});
	}

	/**
	 * Get color for a node based on rules
	 */
	function getColorForNode(node) {
		if (!currentState.colors) return '#999999';

		const rule = currentState.colors.find(r => r.kind === node.kind);
		return rule ? rule.color : '#999999';
	}

	/**
	 * Get shape for node kind
	 */
	function getShapeForKind(kind) {
		switch (kind) {
			case 'folder': return 'box';
			case 'file': return 'ellipse';
			case 'class': return 'diamond';
			case 'function': return 'dot';
			case 'method': return 'dot';
			default: return 'dot';
		}
	}

	// Initialize immediately
	initializeEventListeners();
})();

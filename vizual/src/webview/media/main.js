(function () {
	const vscode = acquireVsCodeApi();
	const defaultPhysics = {
		centerForce: 0.05,
		linkForce: 0.03,
		linkLength: 180,
		lineThickness: 2
	};

	const savedState = vscode.getState?.();
	let network = null;
	let currentNodes = [];
	let currentState = savedState || {
		filters: null,
		colors: null,
		root: '',
		activeMode: false,
		debugMode: false,
		physics: { ...defaultPhysics }
	};

	// Initialize UI
	document.addEventListener('DOMContentLoaded', () => {
		initializeEventListeners();
		populatePhysicsControls();
	});

	/**
	 * Initialize event listeners
	 */
	function initializeEventListeners() {
		// Change root button
		document.getElementById('change-root')?.addEventListener('click', () => {
			vscode.postMessage({ type: 'root/pick' });
		});

		// Settings panel toggle
		const settingsPanel = document.getElementById('settings-panel');
		document.getElementById('open-settings')?.addEventListener('click', () => {
			if (settingsPanel) settingsPanel.setAttribute('data-open', 'true');
		});
		document.getElementById('close-settings')?.addEventListener('click', () => {
			if (settingsPanel) settingsPanel.setAttribute('data-open', 'false');
		});

		// Active mode toggle
		document.getElementById('active-mode')?.addEventListener('change', (e) => {
			currentState.activeMode = e.target.checked;
			persistState();
			vscode.postMessage({ 
				type: 'activeMode/set', 
				value: e.target.checked 
			});
			repaintNetwork();
		});

		// Debug highlight toggle (local only)
		document.getElementById('debug-mode')?.addEventListener('change', (e) => {
			currentState.debugMode = e.target.checked;
			persistState();
			updateNodeColors();
			repaintNetwork();
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

		// Apply colors
		document.getElementById('apply-colors')?.addEventListener('click', () => {
			const updatedRules = collectColorRules();
			currentState.colors = updatedRules;
			persistState();
			vscode.postMessage({
				type: 'colors/set',
				colors: updatedRules
			});
		});

		// Physics sliders
		bindPhysicsSlider('center-force', 'center-force-value', (val) => {
			currentState.physics.centerForce = val;
			persistState();
			applyPhysics();
		});

		bindPhysicsSlider('link-force', 'link-force-value', (val) => {
			currentState.physics.linkForce = val;
			persistState();
			applyPhysics();
		});

		bindPhysicsSlider('link-length', 'link-length-value', (val) => {
			currentState.physics.linkLength = val;
			persistState();
			applyPhysics();
		});

		bindPhysicsSlider('line-thickness', 'line-thickness-value', (val) => {
			currentState.physics.lineThickness = val;
			persistState();
			applyEdgeOptions();
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

		// Store nodes for click handler access
		currentNodes = nodes;
		// Store edges for hover highlight access
		currentEdges = edges;

		// Find root node (first node or node with kind folder and no incoming edges)
		const rootNode = nodes.find(n => {
			const hasParent = edges.some(e => e.to === n.id);
			return !hasParent;
		});

		// Transform nodes for vis-network
		const visNodes = nodes.map(node => {
			let color;

			if (currentState.debugMode) {
				// In debug mode: gradient from yellow (top of stack) to green (deeper frames)
				color = '#666666';
				if (node.isDebugActive || node.isDebugSymbolActive) {
					if (node.debugStackDepth !== undefined) {
						// Gradient: depth 0 (top) = yellow, depth 1-2 = yellow-green blend, depth 3+ = green
						color = getDebugStackColor(node.debugStackDepth);
					} else {
						// File in stack but no specific depth info
						color = '#00ff00';
					}
				}
			} else {
				color = getColorForNode(node);

				// Apply hover highlight: when hovering, dim all except hovered node and its children
				if (hoveredNodeId) {
					const isHovered = node.id === hoveredNodeId;
					const isChild = hoveredChildren.has(node.id);
					if (!isHovered && !isChild) {
						color = '#666666';
					}
				} else {
					// Apply active mode dimming when not hovering
					if (currentState.activeMode) {
						if (!node.isActive && !node.hasBreakpoint) {
							color = '#666666';
						}
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
			}

			const visNode = {
				id: node.id,
				label: node.label,
				color: color,
				shape: getShapeForKind(node.kind),
				font: { color: '#ffffff' }
			};

			// Pin root node to prevent drift
			if (rootNode && node.id === rootNode.id) {
				visNode.fixed = { x: true, y: true };
				visNode.x = 0;
				visNode.y = 0;
			}

			return visNode;
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

		const options = buildOptions();

		// Capture current zoom and position before update
		let previousScale = 1;
		let previousPosition = { x: 0, y: 0 };
		if (network) {
			previousScale = network.getScale();
			previousPosition = network.getViewPosition();
		}

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
						// Find node to check if expanded (use currentNodes from closure)
						const node = currentNodes.find(n => n.id === nodeId);
						if (node && node.isExpanded) {
							// Collapse
							vscode.postMessage({
								type: 'node/collapse',
								nodeId: nodeId
							});
						} else {
							// Expand
							vscode.postMessage({
								type: 'node/expand',
								nodeId: nodeId
							});
						}
					}
				}
			});

			// Handle hover highlight - update colors only, no graph recreation
			network.on('hoverNode', (params) => {
				// Skip hover updates while dragging to prevent flicker
				if (isDragging) return;
				
				const nodeId = params.node;
				hoveredNodeId = nodeId;
				// Compute direct children via edges
				hoveredChildren.clear();
				currentEdges
					.filter(e => e.from === nodeId)
					.forEach(e => hoveredChildren.add(e.to));
				// Update colors without recreating graph
			updateNodeColors();
			});

			network.on('blurNode', () => {
				// Skip blur updates while dragging to prevent flicker
				if (isDragging) return;
				
				hoveredNodeId = null;
				hoveredChildren.clear();
				updateNodeColors();
			});

			// Track drag state to stabilize hover highlight
			network.on('dragStart', () => {
				isDragging = true;
			});

			network.on('dragEnd', () => {
				isDragging = false;
				// Refresh hover state after drag
				updateNodeColors();
			});
		} else {
			network.setData(data);
			network.setOptions(options);
			// Restore zoom and position after update
			network.moveTo({ position: previousPosition, scale: previousScale });
		}
	}

	/**
	 * Check if incoming state represents a structural change (nodes/edges modified)
	 */
	function isStructuralChange(newNodes) {
		if (!currentNodes || currentNodes.length !== newNodes.length) {
			return true;
		}
		// Check if node IDs match (structural change if not)
		const oldIds = new Set(currentNodes.map(n => n.id));
		const newIds = new Set(newNodes.map(n => n.id));
		if (oldIds.size !== newIds.size) return true;
		for (const id of oldIds) {
			if (!newIds.has(id)) return true;
		}
		return false;
	}

	/**
	 * Update state UI
	 */
	function updateState(state) {
		const oldNodes = currentNodes;
		currentState = {
			...currentState,
			...state,
			physics: currentState.physics || { ...defaultPhysics }
		};
		persistState();

		// If graph structure hasn't changed, just update colors to avoid jitter
		if (state.nodes && !isStructuralChange(state.nodes) && oldNodes) {
			currentNodes = state.nodes;
			currentEdges = state.edges || currentEdges;
			updateNodeColors();
		}

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

		// Update debug mode checkbox (stored locally)
		const debugModeEl = document.getElementById('debug-mode');
		if (debugModeEl) {
			debugModeEl.checked = currentState.debugMode;
		}

		// Always refresh colors when state updates to handle debug flag changes
		if (oldNodes) {
			updateNodeColors();
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

		populatePhysicsControls();
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

	function collectColorRules() {
		const container = document.getElementById('color-rules');
		if (!container || !currentState.colors) return currentState.colors || [];

		const updated = [];
		const rows = container.querySelectorAll('.color-rule-item');
		rows.forEach((row, idx) => {
			const colorInput = row.querySelector('input[type="color"]');
			const rule = currentState.colors[idx];
			if (rule && colorInput) {
				updated.push({ ...rule, color: colorInput.value });
			}
		});
		return updated;
	}

	/**
	 * Update node colors in DataSet without recreating graph
	 */
	function updateNodeColors() {
		if (!network) return;
		const updates = currentNodes.map(node => {
			let color;

			if (currentState.debugMode) {
				// In debug mode: gradient from yellow (top of stack) to green (deeper frames)
				color = '#666666';
				if (node.isDebugActive || node.isDebugSymbolActive) {
					if (node.debugStackDepth !== undefined) {
						// Gradient: depth 0 (top) = yellow, depth 1-2 = yellow-green blend, depth 3+ = green
						color = getDebugStackColor(node.debugStackDepth);
					} else {
						// File in stack but no specific depth info
						color = '#00ff00';
					}
				}
			} else {
				color = getColorForNode(node);
				
				// Apply hover highlight: when hovering, dim all except hovered node and its children
				if (hoveredNodeId) {
					const isHovered = node.id === hoveredNodeId;
					const isChild = hoveredChildren.has(node.id);
					if (!isHovered && !isChild) {
						color = '#666666';
					}
				} else {
					// Apply active mode dimming when not hovering
					if (currentState.activeMode) {
						if (!node.isActive && !node.hasBreakpoint) {
							color = '#666666';
						}
					}
				}
				
				// Breakpoint color always wins
				if (node.hasBreakpoint) {
					color = '#ff0000';
				}

				// Active file color always wins
				if (node.isActive) {
					color = '#00ff00';
				}
			}
			
			return { id: node.id, color: color };
		});
		
		network.body.data.nodes.update(updates);
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
	 * Get debug stack color based on depth (yellow at top, green deeper)
	 */
	function getDebugStackColor(depth) {
		// depth 0 (top) = yellow (#ffff00)
		// depth 1 = yellow-green blend (#80ff00)
		// depth 2 = more green (#40ff00)
		// depth 3+ = pure green (#00ff00)
		if (depth === 0) return '#ffff00';
		if (depth === 1) return '#aaff00';
		if (depth === 2) return '#55ff00';
		return '#00ff00';
	}

	/**
	 * Get shape for node kind
	 */
	function getShapeForKind(kind) {
		switch (kind) {
			case 'folder': return 'box';
			case 'file': return 'dot';
			case 'class': return 'star';
			case 'function': return 'triangle';
			case 'method': return 'triangleDown';
			case 'variable': return 'dot';
			case 'interface': return 'diamond';
			case 'enum': return 'square';
			case 'namespace': return 'hexagon';
			case 'property': return 'dot';
			case 'constant': return 'dot';
			case 'constructor': return 'triangleDown';
			default: return 'dot';
		}
	}

	// Hover highlight state
	let hoveredNodeId = null;
	const hoveredChildren = new Set();
	let currentEdges = [];
	let isDragging = false;

	function buildOptions() {
		return {
			layout: {
				improvedLayout: false
			},
			physics: {
				enabled: true,
				solver: 'forceAtlas2Based',
				stabilization: {
					enabled: true,
					iterations: 50,
					updateInterval: 10
				},
				adaptiveTimestep: true,
				minVelocity: 0.05,
				forceAtlas2Based: {
					centralGravity: 0.1 * (currentState.physics?.centerForce ?? defaultPhysics.centerForce),
					springConstant: currentState.physics?.linkForce ?? defaultPhysics.linkForce,
					springLength: currentState.physics?.linkLength ?? defaultPhysics.linkLength,
					damping: 0.65,
					avoidOverlap: 0.5
				}
			},
			interaction: {
				hover: true,
				dragNodes: true,
				zoomView: true
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
				width: currentState.physics?.lineThickness ?? defaultPhysics.lineThickness,
				smooth: {
					enabled: true,
					type: 'continuous',
					roundness: 0.5
				}
			}
		};
	}

	function applyPhysics() {
		if (!network) return;
		network.setOptions({ physics: buildOptions().physics });
	}

	function applyEdgeOptions() {
		if (!network) return;
		const thickness = currentState.physics?.lineThickness ?? defaultPhysics.lineThickness;
		network.setOptions({
			edges: {
				width: thickness
			}
		});
	}

	function repaintNetwork() {
		if (!network) return;
		network.redraw();
	}

	function bindPhysicsSlider(inputId, valueId, onChange) {
		const input = document.getElementById(inputId);
		const valueEl = document.getElementById(valueId);
		if (!input || !valueEl) return;
		input.addEventListener('input', (e) => {
			const val = parseFloat(e.target.value);
			valueEl.textContent = val.toString();
			onChange(val);
		});
	}

	function populatePhysicsControls() {
		const physics = currentState.physics || defaultPhysics;
		setSliderValue('center-force', 'center-force-value', physics.centerForce);
		setSliderValue('link-force', 'link-force-value', physics.linkForce);
		setSliderValue('link-length', 'link-length-value', physics.linkLength);
		setSliderValue('line-thickness', 'line-thickness-value', physics.lineThickness);
	}

	function setSliderValue(inputId, valueId, value) {
		const input = document.getElementById(inputId);
		const valueEl = document.getElementById(valueId);
		if (input) input.value = String(value);
		if (valueEl) valueEl.textContent = String(value);
	}

	function persistState() {
		vscode.setState?.(currentState);
	}
})();

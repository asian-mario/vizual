(function () {
  const vscode = acquireVsCodeApi();
  const defaultPhysics = {
    centerForce: 0.05,
    linkForce: 0.03,
    linkLength: 180,
    lineThickness: 2,
  };
  const CODE_FILE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".java",
    ".cs",
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".h",
    ".hh",
    ".hpp",
    ".hxx",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".swift",
    ".kt",
    ".kts",
    ".scala",
    ".lua",
    ".dart",
    ".json",
    ".jsonc",
    ".xml",
    ".yml",
    ".yaml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".sql",
    ".r",
  ]);

  const savedState = vscode.getState?.();
  let network = null;
  let currentNodes = [];
  let currentEdges = [];
  let hoveredNodeId = null;
  let hoveredChildren = new Set();
  let hoverAffectsColors = false;
  let isDragging = false;
  let hoverTimeout = null;
  let currentHoverPopup = null;
  let currentHoverPopupNodeId = null;
  let snippetRequestSeq = 0;
  let isAnimatingExpand = false;
  let pendingSpawnParents = new Set();
  let wasPhysicsPausedBeforeAnimation = false;
  let animationCancelRequested = false;
  let animationSnapshot = null;
  let spawnHiddenNodeIds = new Set();
  let animationVisibleDepth = 0;

  let currentState = savedState || {
    filters: null,
    colors: null,
    root: "",
    activeMode: false,
    dependencyMode: false,
    debugMode: false,
    errorWarningHighlighting: false,
    statsCollapsed: false,
    physicsPaused: false,
    animateDepth: 2,
    animateSpeed: 1,
    physics: { ...defaultPhysics },
  };

  if (typeof currentState.errorWarningHighlighting !== "boolean") {
    currentState.errorWarningHighlighting = false;
  }

  if (typeof currentState.dependencyMode !== "boolean") {
    currentState.dependencyMode = false;
  }

  if (typeof currentState.statsCollapsed !== "boolean") {
    currentState.statsCollapsed = false;
  }

  // Initialize UI
  document.addEventListener("DOMContentLoaded", () => {
    initializeEventListeners();
    populatePhysicsControls();
  });

  /**
   * Initialize event listeners
   */
  function initializeEventListeners() {
    // Change root button
    document.getElementById("change-root")?.addEventListener("click", () => {
      vscode.postMessage({ type: "root/pick" });
    });

    // Settings panel toggle
    const settingsPanel = document.getElementById("settings-panel");
    document.getElementById("open-settings")?.addEventListener("click", () => {
      if (settingsPanel) settingsPanel.setAttribute("data-open", "true");
    });
    document.getElementById("close-settings")?.addEventListener("click", () => {
      if (settingsPanel) settingsPanel.setAttribute("data-open", "false");
    });

    // Active mode toggle
    document.getElementById("active-mode")?.addEventListener("change", (e) => {
      currentState.activeMode = e.target.checked;
      persistState();
      vscode.postMessage({
        type: "activeMode/set",
        value: e.target.checked,
      });
      repaintNetwork();
    });

    // Debug highlight toggle (local only)
    document.getElementById("debug-mode")?.addEventListener("change", (e) => {
      currentState.debugMode = e.target.checked;
      persistState();
      updateNodeColors();
      repaintNetwork();
    });

    document
      .getElementById("dependency-mode")
      ?.addEventListener("change", (e) => {
        const enabled = e.target.checked;
        currentState.dependencyMode = enabled;
        persistState();
        vscode.postMessage({
          type: "dependencyMode/set",
          value: enabled,
        });
      });

    // Error/warning highlighting toggle (local only)
    document
      .getElementById("error-warning-highlighting")
      ?.addEventListener("change", (e) => {
        currentState.errorWarningHighlighting = e.target.checked;
        persistState();
        updateNodeColors();
        repaintNetwork();
      });

    // Apply filters
    document.getElementById("apply-filters")?.addEventListener("click", () => {
      const includePatterns = document
        .getElementById("include-patterns")
        .value.split("\n")
        .filter((p) => p.trim());
      const excludePatterns = document
        .getElementById("exclude-patterns")
        .value.split("\n")
        .filter((p) => p.trim());
      const maxDepth =
        parseInt(document.getElementById("max-depth").value) || 10;
      const maxNodes =
        parseInt(document.getElementById("max-nodes").value) || 1000;

      vscode.postMessage({
        type: "filters/set",
        filters: {
          includePatterns,
          excludePatterns,
          maxDepth,
          maxNodes,
        },
      });
    });

    // Apply colors
    document.getElementById("apply-colors")?.addEventListener("click", () => {
      const updatedRules = collectColorRules();
      currentState.colors = updatedRules;
      persistState();
      vscode.postMessage({
        type: "colors/set",
        colors: updatedRules,
      });
    });

    // Physics sliders
    bindPhysicsSlider("center-force", "center-force-value", (val) => {
      currentState.physics.centerForce = val;
      persistState();
      applyPhysics();
    });

    bindPhysicsSlider("link-force", "link-force-value", (val) => {
      currentState.physics.linkForce = val;
      persistState();
      applyPhysics();
    });

    bindPhysicsSlider("link-length", "link-length-value", (val) => {
      currentState.physics.linkLength = val;
      persistState();
      applyPhysics();
    });

    bindPhysicsSlider("line-thickness", "line-thickness-value", (val) => {
      currentState.physics.lineThickness = val;
      persistState();
      applyEdgeOptions();
    });

    const animateDepthEl = document.getElementById("animate-depth");
    if (animateDepthEl) {
      animateDepthEl.value = String(getAnimateDepthValue());
      animateDepthEl.addEventListener("change", () => {
        currentState.animateDepth = getAnimateDepthValue();
        animateDepthEl.value = String(currentState.animateDepth);
        persistState();
      });
    }

    const animateSpeedEl = document.getElementById("animate-speed");
    const animateSpeedValueEl = document.getElementById("animate-speed-value");
    if (animateSpeedEl && animateSpeedValueEl) {
      const setSpeedLabel = (speed) => {
        animateSpeedValueEl.textContent = `${speed.toFixed(1)}x`;
      };

      const speed = getAnimateSpeedValue();
      animateSpeedEl.value = String(speed);
      setSpeedLabel(speed);

      animateSpeedEl.addEventListener("input", () => {
        currentState.animateSpeed = getAnimateSpeedValue();
        animateSpeedEl.value = String(currentState.animateSpeed);
        setSpeedLabel(currentState.animateSpeed);
        persistState();
      });
    }

    document
      .getElementById("animate-graph")
      ?.addEventListener("click", async () => {
        await animateExpandFromRoot();
      });

    // Keyboard shortcut: toggle physics pause/resume with P
    window.addEventListener("keydown", (e) => {
      if (e.key?.toLowerCase() !== "p") return;

      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        activeTag === "select"
      ) {
        return;
      }

      e.preventDefault();
      togglePhysicsPause();

      // Prevent focus-ring artifacts after keyboard toggles
      if (
        document.activeElement &&
        typeof document.activeElement.blur === "function"
      ) {
        document.activeElement.blur();
      }
    });

    // ESC: cancel running animation and restore pre-animation graph state
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!isAnimatingExpand) return;
      e.preventDefault();
      requestCancelAnimation();
    });

    document.getElementById("stats-toggle")?.addEventListener("click", () => {
      currentState.statsCollapsed = !currentState.statsCollapsed;
      setStatsCollapsed(currentState.statsCollapsed);
      persistState();
    });

    setStatsCollapsed(currentState.statsCollapsed);
  }

  /**
   * Handle messages from extension
   */
  window.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.type) {
      case "graph/update":
        updateGraph(message.nodes, message.edges, message.meta);
        break;

      case "state/update":
        updateState(message);
        break;

      case "node/snippet":
        applySnippetToPopup(message);
        break;
    }
  });

  /**
   * Update graph visualization
   */
  function updateGraph(nodes, edges, meta = {}) {
    const container = document.getElementById("graph-container");
    if (!container) return;

    if (!isAnimatingExpand && spawnHiddenNodeIds.size > 0) {
      spawnHiddenNodeIds.clear();
    }

    const previousNodeIds = new Set(currentNodes.map((n) => n.id));
    const previousNodePositions = network
      ? network.getPositions(currentNodes.map((n) => n.id))
      : {};

    // Store nodes for click handler access
    currentNodes = nodes;
    // Store edges for hover highlight access
    currentEdges = edges;
    updateStatsPanel(meta?.stats);

    const containmentEdges = getContainmentEdges();
    const animationDepthMap = isAnimatingExpand ? getNodeDepthMap() : null;

    // Find root node (first node or node with kind folder and no incoming edges)
    const rootNode = nodes.find((n) => {
      const hasParent = containmentEdges.some((e) => e.to === n.id);
      return !hasParent;
    });

    let animatedHiddenNodeIds = spawnHiddenNodeIds;
    if (isAnimatingExpand) {
      animatedHiddenNodeIds = new Set(spawnHiddenNodeIds);

      let addedHiddenNode;
      do {
        addedHiddenNode = false;

        for (const node of nodes) {
          if (animatedHiddenNodeIds.has(node.id)) continue;

          const shouldHideFromAnimatedParent = containmentEdges.some(
            (e) =>
              e.to === node.id &&
              (pendingSpawnParents.has(e.from) ||
                animatedHiddenNodeIds.has(e.from)),
          );

          if (shouldHideFromAnimatedParent) {
            animatedHiddenNodeIds.add(node.id);
            addedHiddenNode = true;
          }
        }
      } while (addedHiddenNode);

      if (animatedHiddenNodeIds.size !== spawnHiddenNodeIds.size) {
        spawnHiddenNodeIds.clear();
        for (const nodeId of animatedHiddenNodeIds) {
          spawnHiddenNodeIds.add(nodeId);
        }
      }
    }

    // Transform nodes for vis-network
    const visNodes = nodes.map((node) => {
      const color = getDisplayColorForNode(node);
      const nodeDepth = animationDepthMap
        ? animationDepthMap.get(node.id)
        : undefined;
      const isDepthHidden =
        isAnimatingExpand &&
        typeof nodeDepth === "number" &&
        nodeDepth > animationVisibleDepth;
      const shouldHideDuringAnimation =
        isDepthHidden ||
        (isAnimatingExpand && animatedHiddenNodeIds.has(node.id));

      const visNode = {
        id: node.id,
        label: node.label,
        color: color,
        shape: getShapeForKind(node.kind),
        font: { color: "#ffffff" },
      };

      if (shouldHideDuringAnimation) {
        visNode.hidden = true;
        visNode.physics = false;
        visNode.fixed = { x: true, y: true };
      }

      // Preserve existing node positions to avoid visual jumps during updates.
      const previousPos = previousNodePositions[node.id];
      if (previousPos) {
        visNode.x = previousPos.x;
        visNode.y = previousPos.y;
      } else if (isAnimatingExpand && !previousNodeIds.has(node.id)) {
        // New nodes spawned by animation start at their expanded parent position.
        const parentEdge = containmentEdges.find(
          (e) => e.to === node.id && pendingSpawnParents.has(e.from),
        );
        if (parentEdge) {
          const parentPos = previousNodePositions[parentEdge.from];
          if (parentPos) {
            visNode.x = parentPos.x;
            visNode.y = parentPos.y;
          }
        }
      }

      // Pin root node to prevent drift
      if (rootNode && node.id === rootNode.id) {
        visNode.fixed = { x: true, y: true };
        visNode.x = 0;
        visNode.y = 0;
      }

      return visNode;
    });

    // Transform edges for vis-network
    const visEdges = edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      arrows: "to",
      color: getEdgeColor(edge.kind),
      dashes: edge.kind === "dependsExternal",
    }));

    const data = {
      nodes: new vis.DataSet(visNodes),
      edges: new vis.DataSet(visEdges),
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
      network.on("click", (params) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const isCtrlPressed =
            params.event.srcEvent.ctrlKey || params.event.srcEvent.metaKey;

          if (isCtrlPressed) {
            vscode.postMessage({
              type: "node/open",
              nodeId: nodeId,
              ctrlKey: true,
            });
          } else {
            // Find node to check if expanded (use currentNodes from closure)
            const node = currentNodes.find((n) => n.id === nodeId);
            if (node && node.isExpanded) {
              // Collapse
              vscode.postMessage({
                type: "node/collapse",
                nodeId: nodeId,
              });
            } else {
              // Expand
              vscode.postMessage({
                type: "node/expand",
                nodeId: nodeId,
              });
            }
          }
        }
      });

      // Handle hover highlight - update colors only, no graph recreation
      network.on("hoverNode", (params) => {
        // Skip hover updates while dragging to prevent flicker
        if (isDragging) return;

        const nodeId = params.node;
        // Compute direct children via edges
        hoveredChildren.clear();
        currentEdges
          .filter((e) => e.from === nodeId)
          .forEach((e) => hoveredChildren.add(e.to));

        // Only trigger color refresh when hover can affect other nodes (has children)
        hoverAffectsColors = hoveredChildren.size > 0;
        hoveredNodeId = hoverAffectsColors ? nodeId : null;

        // Clear previous hover timeout
        if (hoverTimeout) clearTimeout(hoverTimeout);

        // Show info popup after 500ms
        hoverTimeout = setTimeout(() => {
          const node = currentNodes.find((n) => n.id === nodeId);
          if (node) {
            showHoverInfoPopup(node, params);
          }
        }, 500);

        if (hoverAffectsColors) {
          updateNodeColors();
        }
      });

      network.on("blurNode", () => {
        // Skip blur updates while dragging to prevent flicker
        if (isDragging) return;

        const shouldRefreshColors = hoverAffectsColors;
        hoverAffectsColors = false;
        hoveredNodeId = null;
        hoveredChildren.clear();

        // Clear hover timeout and popup
        if (hoverTimeout) clearTimeout(hoverTimeout);
        if (currentHoverPopup) {
          currentHoverPopup.remove();
          currentHoverPopup = null;
        }

        if (shouldRefreshColors) {
          updateNodeColors();
        }
      });

      // Track drag state to stabilize hover highlight
      network.on("dragStart", () => {
        isDragging = true;
      });

      network.on("dragEnd", () => {
        isDragging = false;
        // Refresh hover state after drag
        updateNodeColors();
      });
    } else {
      const nodeDataSet = network.body.data.nodes;
      const edgeDataSet = network.body.data.edges;

      const incomingNodeIds = new Set(visNodes.map((n) => n.id));
      const incomingEdgeIds = new Set(visEdges.map((e) => e.id));

      const removeNodeIds = nodeDataSet
        .getIds()
        .filter((id) => !incomingNodeIds.has(id));
      const removeEdgeIds = edgeDataSet
        .getIds()
        .filter((id) => !incomingEdgeIds.has(id));

      if (removeEdgeIds.length) edgeDataSet.remove(removeEdgeIds);
      if (removeNodeIds.length) nodeDataSet.remove(removeNodeIds);

      nodeDataSet.update(visNodes);
      edgeDataSet.update(visEdges);

      if (!isAnimatingExpand) {
        network.setOptions(options);
      }

      // Preserve camera state for non-animated updates while avoiding full reset.
      if (!isAnimatingExpand) {
        network.moveTo({ position: previousPosition, scale: previousScale });
      }
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
    const oldIds = new Set(currentNodes.map((n) => n.id));
    const newIds = new Set(newNodes.map((n) => n.id));
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
      physics: currentState.physics || { ...defaultPhysics },
    };
    persistState();

    // If graph structure hasn't changed, just update colors to avoid jitter
    if (state.nodes && !isStructuralChange(state.nodes) && oldNodes) {
      currentNodes = state.nodes;
      currentEdges = state.edges || currentEdges;
      updateNodeColors();
    }

    // Update root path display
    const rootPathEl = document.getElementById("root-path");
    if (rootPathEl) {
      rootPathEl.textContent = state.root;
    }

    // Update active mode checkbox
    const activeModeEl = document.getElementById("active-mode");
    if (activeModeEl) {
      activeModeEl.checked = state.activeMode;
    }

    // Update debug mode checkbox (stored locally)
    const debugModeEl = document.getElementById("debug-mode");
    if (debugModeEl) {
      debugModeEl.checked = currentState.debugMode;
    }

    const dependencyModeEl = document.getElementById("dependency-mode");
    if (dependencyModeEl) {
      dependencyModeEl.checked = !!state.dependencyMode;
    }
    currentState.dependencyMode = !!state.dependencyMode;

    const errorWarningHighlightingEl = document.getElementById(
      "error-warning-highlighting",
    );
    if (errorWarningHighlightingEl) {
      errorWarningHighlightingEl.checked =
        !!currentState.errorWarningHighlighting;
    }

    const animateDepthEl = document.getElementById("animate-depth");
    if (animateDepthEl) {
      animateDepthEl.value = String(getAnimateDepthValue());
    }

    const animateSpeedEl = document.getElementById("animate-speed");
    const animateSpeedValueEl = document.getElementById("animate-speed-value");
    if (animateSpeedEl) {
      animateSpeedEl.value = String(getAnimateSpeedValue());
    }
    if (animateSpeedValueEl) {
      animateSpeedValueEl.textContent = `${getAnimateSpeedValue().toFixed(1)}x`;
    }

    // Always refresh colors when state updates to handle debug flag changes
    if (oldNodes) {
      updateNodeColors();
    }

    // Update filter fields
    if (state.filters) {
      const includeEl = document.getElementById("include-patterns");
      const excludeEl = document.getElementById("exclude-patterns");
      const maxDepthEl = document.getElementById("max-depth");
      const maxNodesEl = document.getElementById("max-nodes");

      if (includeEl) includeEl.value = state.filters.includePatterns.join("\n");
      if (excludeEl) excludeEl.value = state.filters.excludePatterns.join("\n");
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
    const container = document.getElementById("color-rules");
    if (!container) return;

    container.innerHTML = "";
    colors.forEach((rule, index) => {
      const div = document.createElement("div");
      div.className = "color-rule-item";

      const label = document.createElement("span");
      label.textContent = rule.kind || rule.fileExtension || "Unknown";

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = rule.color;
      colorInput.addEventListener("change", (e) => {
        colors[index].color = e.target.value;
      });

      div.appendChild(label);
      div.appendChild(colorInput);
      container.appendChild(div);
    });
  }

  function collectColorRules() {
    const container = document.getElementById("color-rules");
    if (!container || !currentState.colors) return currentState.colors || [];

    const updated = [];
    const rows = container.querySelectorAll(".color-rule-item");
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
    const updates = currentNodes.map((node) => {
      return { id: node.id, color: getDisplayColorForNode(node) };
    });

    network.body.data.nodes.update(updates);
  }

  function getContainmentEdges() {
    return currentEdges.filter((edge) => edge.kind === "contains");
  }

  function getEdgeColor(kind) {
    if (kind === "dependsLocal") {
      return "#22c55e";
    }

    if (kind === "dependsExternal") {
      return "#3b82f6";
    }

    return "#848484";
  }

  function setStatsCollapsed(collapsed) {
    const panel = document.getElementById("stats-panel");
    const toggle = document.getElementById("stats-toggle");
    if (!panel || !toggle) return;

    panel.setAttribute("data-collapsed", collapsed ? "true" : "false");
    toggle.textContent = collapsed ? "+" : "−";
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Expand stats" : "Minimize stats",
    );
  }

  function updateStatsPanel(stats) {
    if (!stats) {
      return;
    }

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = String(value);
      }
    };

    setText(
      "stats-files",
      Number.isFinite(stats.fileCount) ? stats.fileCount : 0,
    );
    setText(
      "stats-loc",
      Number.isFinite(stats.linesOfCode) ? stats.linesOfCode : 0,
    );
    setText(
      "stats-deps",
      Number.isFinite(stats.dependencyCount) ? stats.dependencyCount : 0,
    );
    setText(
      "stats-errors",
      Number.isFinite(stats.errorCount) ? stats.errorCount : 0,
    );
    setText(
      "stats-warnings",
      Number.isFinite(stats.warningCount) ? stats.warningCount : 0,
    );
  }

  function getDisplayColorForNode(node) {
    if (currentState.errorWarningHighlighting) {
      return getDiagnosticHighlightColor(node);
    }

    let color;

    if (currentState.debugMode) {
      color = "#666666";
      if (node.isDebugActive || node.isDebugSymbolActive) {
        if (node.debugStackDepth !== undefined) {
          color = getDebugStackColor(node.debugStackDepth);
        } else {
          color = "#00ff00";
        }
      }
      return color;
    }

    color = getColorForNode(node);

    if (hoveredNodeId) {
      const isHovered = node.id === hoveredNodeId;
      const isChild = hoveredChildren.has(node.id);
      if (!isHovered && !isChild) {
        color = "#666666";
      }
    } else if (currentState.activeMode) {
      if (!node.isActive && !node.hasBreakpoint) {
        color = "#666666";
      }
    }

    if (node.hasBreakpoint) {
      color = "#ff0000";
    }

    if (node.isActive) {
      color = "#00ff00";
    }

    return color;
  }

  function getDiagnosticHighlightColor(node) {
    if (!isCodeFileNode(node)) {
      return "#666666";
    }

    const errors = Number.isFinite(node.diagnosticsErrors)
      ? Math.max(0, node.diagnosticsErrors)
      : 0;
    const warnings = Number.isFinite(node.diagnosticsWarnings)
      ? Math.max(0, node.diagnosticsWarnings)
      : 0;

    if (errors > 0) {
      return "#ff0000";
    }

    if (warnings > 0) {
      return "#ffff00";
    }

    return "#00ff00";
  }

  function isCodeFileNode(node) {
    if (typeof node.isCodeFile === "boolean") {
      return node.isCodeFile;
    }

    if (!node.uri && !node.label) {
      return false;
    }

    const source = String(node.uri || node.label).toLowerCase();
    const extensionMatch = source.match(/\.[a-z0-9]+$/);
    if (!extensionMatch) {
      return false;
    }

    return CODE_FILE_EXTENSIONS.has(extensionMatch[0]);
  }

  /**
   * Get color for a node based on rules
   */
  function getColorForNode(node) {
    if (!currentState.colors) return "#999999";

    const rule = currentState.colors.find((r) => r.kind === node.kind);
    return rule ? rule.color : "#999999";
  }

  /**
   * Get debug stack color based on depth (yellow at top, green deeper)
   */
  function getDebugStackColor(depth) {
    // depth 0 (top) = yellow (#ffff00)
    // depth 1 = yellow-green blend (#80ff00)
    // depth 2 = more green (#40ff00)
    // depth 3+ = pure green (#00ff00)
    if (depth === 0) return "#ffff00";
    if (depth === 1) return "#aaff00";
    if (depth === 2) return "#55ff00";
    return "#00ff00";
  }

  /**
   * Get shape for node kind
   */
  function getShapeForKind(kind) {
    switch (kind) {
      case "folder":
        return "box";
      case "file":
        return "dot";
      case "dependency":
        return "ellipse";
      case "class":
        return "star";
      case "function":
        return "triangle";
      case "method":
        return "triangleDown";
      case "variable":
        return "dot";
      case "interface":
        return "diamond";
      case "enum":
        return "square";
      case "namespace":
        return "hexagon";
      case "property":
        return "dot";
      case "constant":
        return "dot";
      case "constructor":
        return "triangleDown";
      default:
        return "dot";
    }
  }

  // Hover highlight state
  // (declared at top with other globals)

  function buildOptions() {
    return {
      layout: {
        improvedLayout: false,
      },
      physics: {
        enabled: !currentState.physicsPaused,
        solver: "forceAtlas2Based",
        stabilization: {
          enabled: true,
          iterations: 50,
          updateInterval: 10,
        },
        adaptiveTimestep: true,
        minVelocity: 0.05,
        forceAtlas2Based: {
          centralGravity:
            0.1 *
            (currentState.physics?.centerForce ?? defaultPhysics.centerForce),
          springConstant:
            currentState.physics?.linkForce ?? defaultPhysics.linkForce,
          springLength:
            currentState.physics?.linkLength ?? defaultPhysics.linkLength,
          damping: 0.65,
          avoidOverlap: 0.5,
        },
      },
      interaction: {
        hover: true,
        dragNodes: true,
        zoomView: true,
      },
      nodes: {
        borderWidth: 2,
        borderWidthSelected: 3,
        font: {
          size: 14,
          color: "#ffffff",
        },
      },
      edges: {
        color: {
          color: "#848484",
          highlight: "#ffffff",
        },
        width:
          currentState.physics?.lineThickness ?? defaultPhysics.lineThickness,
        smooth: {
          enabled: true,
          type: "continuous",
          roundness: 0.5,
        },
      },
    };
  }

  function applyPhysics() {
    if (!network) return;
    network.setOptions({ physics: buildOptions().physics });
  }

  function togglePhysicsPause() {
    currentState.physicsPaused = !currentState.physicsPaused;
    persistState();

    if (!network) return;

    network.setOptions({ physics: buildOptions().physics });
    if (currentState.physicsPaused) {
      network.stopSimulation();
    } else {
      network.startSimulation();
    }
  }

  function getAnimateDepthValue() {
    const input = document.getElementById("animate-depth");
    const raw = input ? parseInt(input.value, 10) : currentState.animateDepth;
    if (Number.isNaN(raw)) return 2;
    return Math.max(1, Math.min(12, raw));
  }

  function getAnimateSpeedValue() {
    const input = document.getElementById("animate-speed");
    const raw = input ? parseFloat(input.value) : currentState.animateSpeed;
    if (Number.isNaN(raw)) return 1;
    return Math.max(0.5, Math.min(2, raw));
  }

  function getRootNodeId() {
    if (!currentNodes.length) return null;
    const hasIncoming = new Set(getContainmentEdges().map((edge) => edge.to));
    const root = currentNodes.find((n) => !hasIncoming.has(n.id));
    return root ? root.id : currentNodes[0].id;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getExpandedExpandableIds() {
    return new Set(
      currentNodes
        .filter(
          (n) =>
            (n.kind === "folder" || n.kind === "file") && Boolean(n.isExpanded),
        )
        .map((n) => n.id),
    );
  }

  function getNodeDepthMap() {
    const depthMap = new Map();
    const rootId = getRootNodeId();
    if (!rootId) return depthMap;

    depthMap.set(rootId, 0);
    const queue = [rootId];

    while (queue.length) {
      const id = queue.shift();
      const baseDepth = depthMap.get(id) ?? 0;
      getContainmentEdges()
        .filter((e) => e.from === id)
        .forEach((e) => {
          if (!depthMap.has(e.to)) {
            depthMap.set(e.to, baseDepth + 1);
            queue.push(e.to);
          }
        });
    }

    return depthMap;
  }

  function waitForExpandedState(nodeId, expectedExpanded, timeoutMs = 1200) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const check = () => {
        const node = currentNodes.find((n) => n.id === nodeId);
        const isExpanded = Boolean(node?.isExpanded);

        if (isExpanded === expectedExpanded) {
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }

        setTimeout(check, 35);
      };

      check();
    });
  }

  function requestCancelAnimation() {
    animationCancelRequested = true;
    const animateButton = document.getElementById("animate-graph");
    if (animateButton) {
      animateButton.textContent = "Cancelling...";
    }
    setAnimationStatus("Cancelling...");
  }

  function setAnimationStatus(text) {
    const statusEl = document.getElementById("animation-status");
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.setAttribute("data-visible", text ? "true" : "false");
  }

  async function restoreAnimationSnapshot() {
    if (!animationSnapshot) return;

    const targetExpanded = animationSnapshot.expandedIds;
    const targetExpandedOrder = animationSnapshot.expandedOrder || [];
    const currentlyExpanded = getExpandedExpandableIds();
    const toCollapse = Array.from(currentlyExpanded).filter(
      (id) => !targetExpanded.has(id),
    );

    const depthMap = getNodeDepthMap();
    toCollapse.sort((a, b) => (depthMap.get(b) ?? 0) - (depthMap.get(a) ?? 0));

    for (const nodeId of toCollapse) {
      vscode.postMessage({ type: "node/collapse", nodeId });
      await waitForExpandedState(nodeId, false, 1000);
      await wait(25);
    }

    // Re-expand nodes that were expanded before animation began.
    for (const nodeId of targetExpandedOrder) {
      let attempts = 0;
      let node = currentNodes.find((n) => n.id === nodeId);

      // Node can be temporarily missing until its parent gets re-expanded.
      while (!node && attempts < 20) {
        await wait(40);
        attempts += 1;
        node = currentNodes.find((n) => n.id === nodeId);
      }

      if (!node || node.isExpanded) {
        continue;
      }

      vscode.postMessage({ type: "node/expand", nodeId });
      await waitForExpandedState(nodeId, true, 1200);
      await wait(25);
    }

    if (network && animationSnapshot.view) {
      network.moveTo({
        position: animationSnapshot.view.position,
        scale: animationSnapshot.view.scale,
      });
    }
  }

  async function collapseToRootBeforeAnimation(expandedIds) {
    if (!expandedIds || expandedIds.size === 0) return;

    const depthMap = getNodeDepthMap();
    const collapseOrder = Array.from(expandedIds).sort(
      (a, b) => (depthMap.get(b) ?? 0) - (depthMap.get(a) ?? 0),
    );

    for (const nodeId of collapseOrder) {
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node || !node.isExpanded) continue;

      vscode.postMessage({ type: "node/collapse", nodeId });
      await waitForExpandedState(nodeId, false, 1200);
      await wait(20);
    }
  }

  function waitForNodePopSettle(timeoutMs = 1200) {
    if (!network) {
      return wait(120);
    }

    return new Promise((resolve) => {
      let done = false;
      let timer = null;

      const cleanup = () => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          network.off("stabilized", onStabilized);
        } catch {
          // ignore if listener already removed
        }
        resolve();
      };

      const onStabilized = () => {
        cleanup();
      };

      network.on("stabilized", onStabilized);
      timer = setTimeout(cleanup, timeoutMs);
    });
  }

  function waitForExpansionSettled(nodeId, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const check = () => {
        const node = currentNodes.find((n) => n.id === nodeId);
        const childCount = getContainmentEdges().filter(
          (e) => e.from === nodeId,
        ).length;

        if ((node && node.isExpanded) || childCount > 0) {
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }

        setTimeout(check, 40);
      };

      check();
    });
  }

  async function animateSiblingChildren(parentId, level, depth) {
    if (!network) return;

    const speed = getAnimateSpeedValue();
    const timeScale = 1 / speed;

    const childIds = getContainmentEdges()
      .filter((e) => e.from === parentId)
      .map((e) => e.to);

    if (!childIds.length) {
      return;
    }

    const parentPos = network.getPositions([parentId])[parentId];
    if (!parentPos) {
      return;
    }

    const nodeDataSet = network.body.data.nodes;

    nodeDataSet.update(
      childIds.map((childId) => ({
        id: childId,
        x: parentPos.x,
        y: parentPos.y,
        hidden: true,
        physics: false,
        fixed: { x: true, y: true },
      })),
    );

    await wait(Math.round(30 * timeScale));

    for (let i = 0; i < childIds.length; i++) {
      const childId = childIds[i];

      spawnHiddenNodeIds.delete(childId);

      nodeDataSet.update({
        id: childId,
        hidden: false,
        physics: true,
        x: parentPos.x,
        y: parentPos.y,
        fixed: { x: true, y: true },
      });

      await wait(Math.round(20 * timeScale));

      nodeDataSet.update({
        id: childId,
        fixed: { x: false, y: false },
      });

      network.startSimulation();
      await waitForNodePopSettle(
        Math.round(
          (getEasedNodeDelay(i, childIds.length, level, depth) + 700) *
            timeScale,
        ),
      );
      await wait(Math.round(100 * timeScale));
    }
  }

  function getEasedNodeDelay(nodeIndex, totalNodes, level, depth) {
    const nodeT = totalNodes <= 1 ? 1 : nodeIndex / Math.max(1, totalNodes - 1);
    const levelT = depth <= 1 ? 1 : level / Math.max(1, depth - 1);
    const easeNode = 1 - Math.pow(1 - nodeT, 2);
    const easeLevel = 1 - Math.pow(1 - levelT, 3);
    const base = 90 + easeLevel * 80;
    return Math.round(base + easeNode * 70);
  }

  function setAnimationPhysicsBoost(enabled) {
    if (!network) return;

    if (!enabled) {
      network.setOptions({ physics: buildOptions().physics });
      if (currentState.physicsPaused) {
        network.stopSimulation();
      }
      return;
    }

    const base = buildOptions().physics;
    network.setOptions({
      physics: {
        ...base,
        enabled: true,
        stabilization: {
          enabled: false,
        },
        minVelocity: 0.03,
        forceAtlas2Based: {
          ...base.forceAtlas2Based,
          damping: 0.58,
          avoidOverlap: 0.35,
          springConstant: (base.forceAtlas2Based?.springConstant ?? 0.03) * 1.2,
          springLength: Math.max(
            55,
            (base.forceAtlas2Based?.springLength ?? 180) * 0.88,
          ),
        },
      },
    });
    network.startSimulation();
  }

  async function animateExpandFromRoot() {
    if (isAnimatingExpand || !currentNodes.length) return;

    const animateButton = document.getElementById("animate-graph");
    const depth = getAnimateDepthValue();
    const speed = getAnimateSpeedValue();
    currentState.animateDepth = depth;
    currentState.animateSpeed = speed;
    persistState();

    isAnimatingExpand = true;
    animationCancelRequested = false;
    wasPhysicsPausedBeforeAnimation = currentState.physicsPaused;
    pendingSpawnParents.clear();
    spawnHiddenNodeIds.clear();
    animationVisibleDepth = 0;
    const expandedBeforeAnimation = getExpandedExpandableIds();
    const depthMapBeforeAnimation = getNodeDepthMap();
    const expandedOrderBeforeAnimation = Array.from(
      expandedBeforeAnimation,
    ).sort(
      (a, b) =>
        (depthMapBeforeAnimation.get(a) ?? 0) -
        (depthMapBeforeAnimation.get(b) ?? 0),
    );
    animationSnapshot = {
      expandedIds: expandedBeforeAnimation,
      expandedOrder: expandedOrderBeforeAnimation,
      view: network
        ? {
            position: network.getViewPosition(),
            scale: network.getScale(),
          }
        : null,
    };

    if (animateButton) {
      animateButton.disabled = true;
      animateButton.textContent = "Animating...";
    }
    setAnimationStatus("");

    try {
      const rootId = getRootNodeId();
      if (!rootId) return;

      // Always reset to root before animation, but keep pre-reset state in snapshot.
      await collapseToRootBeforeAnimation(expandedBeforeAnimation);
      await wait(40);

      setAnimationPhysicsBoost(true);

      let frontier = [rootId];
      const visited = new Set(frontier);

      for (let level = 0; level < depth; level++) {
        animationVisibleDepth = level + 1;

        const expandable = frontier.filter((id) => {
          const node = currentNodes.find((n) => n.id === id);
          if (!node) return false;
          if (node.metadata?.skipSymbolExpansion) return false;
          if (node.kind === "file") {
            // Files start as leaf=true before symbol expansion; allow one expansion pass.
            return !node.isExpanded;
          }
          if (node.kind === "folder") {
            return !node.isExpanded && !node.isLeaf;
          }
          return false;
        });

        if (expandable.length === 0) {
          break;
        }

        const next = new Set();

        for (let idx = 0; idx < expandable.length; idx++) {
          if (animationCancelRequested) break;

          const nodeId = expandable[idx];
          pendingSpawnParents.add(nodeId);
          vscode.postMessage({ type: "node/expand", nodeId });

          // Wait until this parent expansion data is reflected in graph state.
          await waitForExpansionSettled(nodeId);

          // Pop this parent's children one-by-one with settle + 100ms between siblings.
          await animateSiblingChildren(nodeId, level, depth);

          if (animationCancelRequested) {
            pendingSpawnParents.delete(nodeId);
            break;
          }

          getContainmentEdges()
            .filter((e) => e.from === nodeId)
            .forEach((e) => {
              if (e.to === nodeId) return;
              if (!visited.has(e.to)) {
                visited.add(e.to);
                next.add(e.to);
              }
            });

          pendingSpawnParents.delete(nodeId);
          await wait(40);
        }

        if (animationCancelRequested) {
          break;
        }

        frontier = Array.from(next);
        if (frontier.length === 0) break;
      }
    } finally {
      isAnimatingExpand = false;
      pendingSpawnParents.clear();
      spawnHiddenNodeIds.clear();
      animationVisibleDepth = 0;
      currentState.physicsPaused = wasPhysicsPausedBeforeAnimation;
      setAnimationPhysicsBoost(false);

      if (animationCancelRequested) {
        await restoreAnimationSnapshot();
      }

      animationSnapshot = null;
      animationCancelRequested = false;
      setAnimationStatus("");

      if (animateButton) {
        animateButton.disabled = false;
        animateButton.textContent = "Animate";
      }
    }
  }

  function applyEdgeOptions() {
    if (!network) return;
    const thickness =
      currentState.physics?.lineThickness ?? defaultPhysics.lineThickness;
    network.setOptions({
      edges: {
        width: thickness,
      },
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
    input.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valueEl.textContent = val.toString();
      onChange(val);
    });
  }

  function populatePhysicsControls() {
    const physics = currentState.physics || defaultPhysics;
    setSliderValue("center-force", "center-force-value", physics.centerForce);
    setSliderValue("link-force", "link-force-value", physics.linkForce);
    setSliderValue("link-length", "link-length-value", physics.linkLength);
    setSliderValue(
      "line-thickness",
      "line-thickness-value",
      physics.lineThickness,
    );
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

  /**
   * Show hover info popup with code metrics
   */
  function showHoverInfoPopup(node, hoverParams) {
    // Remove existing popup
    if (currentHoverPopup) {
      currentHoverPopup.remove();
    }

    // Calculate info metrics
    const children = currentEdges
      .filter((e) => e.from === node.id)
      .map((e) => currentNodes.find((n) => n.id === e.to))
      .filter((n) => n);

    const variableCount = children.filter(
      (n) =>
        n.kind === "variable" || n.kind === "property" || n.kind === "constant",
    ).length;
    const methodCount = children.filter(
      (n) => n.kind === "method" || n.kind === "function",
    ).length;
    const classCount = children.filter((n) => n.kind === "class").length;
    const interfaceCount = children.filter(
      (n) => n.kind === "interface",
    ).length;
    const totalChildren = children.length;

    const warnings = Number.isFinite(node.diagnosticsWarnings)
      ? Math.max(0, node.diagnosticsWarnings)
      : 0;
    const errors = Number.isFinite(node.diagnosticsErrors)
      ? Math.max(0, node.diagnosticsErrors)
      : 0;
    const nodeNote =
      node.metadata && typeof node.metadata.note === "string"
        ? node.metadata.note
        : "";

    // Create popup element
    const popup = document.createElement("div");
    popup.className = "hover-info-popup";
    popup.style.cssText = `
			position: fixed;
			background: #2d2d30;
			border: 1px solid #464647;
			border-radius: 4px;
			padding: 10px;
			font-size: 12px;
			color: #cccccc;
			font-family: monospace;
			box-shadow: 0 2px 8px rgba(0,0,0,0.3);
			z-index: 10000;
			max-width: 250px;
			pointer-events: none;
		`;

    // Build info content
    const infoLines = [
      `<strong>${node.label}</strong>`,
      `Kind: ${node.kind}`,
      ...(totalChildren > 0 ? [`Children: ${totalChildren}`] : []),
      ...(methodCount > 0 ? [`Methods: ${methodCount}`] : []),
      ...(classCount > 0 ? [`Classes: ${classCount}`] : []),
      ...(interfaceCount > 0 ? [`Interfaces: ${interfaceCount}`] : []),
      ...(variableCount > 0 ? [`Variables: ${variableCount}`] : []),
      ...(errors > 0 ? [`Errors: ${errors}`] : []),
      ...(warnings > 0 ? [`Warnings: ${warnings}`] : []),
      ...(nodeNote ? [`Note: ${nodeNote}`] : []),
    ];

    popup.innerHTML = infoLines
      .map((line) => `<div style="margin: 2px 0;">${line}</div>`)
      .join("");

    // Placeholder for async snippet lookup
    const snippetLine = document.createElement("div");
    snippetLine.className = "hover-snippet";
    snippetLine.style.marginTop = "6px";
    snippetLine.style.color = "#9cdcfe";
    snippetLine.style.whiteSpace = "pre";
    snippetLine.style.overflow = "hidden";
    snippetLine.style.textOverflow = "ellipsis";
    snippetLine.textContent = "Loading snippet (4 lines)...";
    popup.appendChild(snippetLine);

    // Position popup next to node's canvas position
    if (network) {
      const nodePos = network.getPositions([node.id])[node.id];
      if (nodePos) {
        // Convert canvas position to screen coordinates
        const canvasPos = network.canvasToDOM({ x: nodePos.x, y: nodePos.y });
        popup.style.left = canvasPos.x + 15 + "px";
        popup.style.top = canvasPos.y + 15 + "px";
      }
    }

    document.body.appendChild(popup);
    currentHoverPopup = popup;
    currentHoverPopupNodeId = node.id;

    if (node.uri && node.range) {
      const requestId = `snippet-${++snippetRequestSeq}-${Date.now()}`;
      vscode.postMessage({
        type: "node/snippet",
        requestId,
        nodeId: node.id,
      });
    } else {
      snippetLine.remove();
    }

    // Auto-remove after 5 seconds or on any interaction
    const popupTimeout = setTimeout(() => {
      if (currentHoverPopup === popup) {
        popup.remove();
        currentHoverPopup = null;
        currentHoverPopupNodeId = null;
      }
    }, 5000);

    // Remove on mouse move away
    const onMouseMove = () => {
      if (currentHoverPopup === popup) {
        popup.remove();
        currentHoverPopup = null;
        currentHoverPopupNodeId = null;
      }
      document.removeEventListener("mousemove", onMouseMove);
      clearTimeout(popupTimeout);
    };
    document.addEventListener("mousemove", onMouseMove);
  }

  function applySnippetToPopup(message) {
    if (!currentHoverPopup) return;
    if (currentHoverPopupNodeId !== message.nodeId) return;

    const snippetEl = currentHoverPopup.querySelector(".hover-snippet");
    if (!snippetEl) return;

    if (
      typeof message.lineNumber === "number" &&
      Array.isArray(message.lineTexts) &&
      message.lineTexts.length > 0
    ) {
      const lines = message.lineTexts
        .slice(0, 4)
        .map((line, idx) => `L${message.lineNumber + idx}: ${line}`);
      snippetEl.textContent = lines.join("\n");
    } else {
      snippetEl.textContent = "No source snippet available";
    }
  }
})();

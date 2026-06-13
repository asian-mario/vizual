# Change Log

All notable changes to the "vizual" extension will be documented in this file.

## [0.2.2] - 2026-06-12

### New Features

- Added a new **Dependency Graph Mode** for visualising file relationships alongside the existing containment graph.
- Added dependency node and edge support:
  - **Local dependencies** are shown as workspace-linked dependency edges.
  - **External dependencies** are shown as separate dependency nodes.
  - **Unresolved local dependencies** are represented as virtual dependency nodes.

- Added dependency parsing and resolution support for multiple source file types, including TypeScript, JavaScript, Python, Rust, Java, Go, PHP, Ruby, Swift, Kotlin, Scala, Dart, and related web formats.
- Added dedicated styling for dependency nodes and dependency edges.

### Improvements

- Overhauled the **node expansion animation** system for smoother root-to-depth graph expansion.
- Improved animated node spawning so newly expanded child nodes appear from their parent node position instead of abruptly appearing in the graph.
- Added hidden-state handling during expansion animation so child nodes only become visible when their parent is being animated.
- Improved animation stability by preserving node positions, camera position, and zoom level during graph updates.
- Added animation cancellation handling, allowing the graph to restore its previous expanded state when an animation is cancelled.
- Improved animation sequencing with better expansion waiting, child-settling, and physics boosting during animated expansion.
- Updated graph traversal logic so animation and root detection use containment edges only, avoiding dependency edges interfering with expansion depth.
- Improved node updates so existing node metadata and expansion state are preserved instead of being overwritten.
- Improved edge IDs to include edge kind, preventing containment and dependency edges between the same nodes from overwriting each other.
- Improved filtering behaviour so directories continue to be traversed when include patterns are used, allowing deep file matches to appear correctly.
- Improved filter matching with normalized paths and case-insensitive matching on Windows.

### Fixes

- Fixed cases where expanding a file could leave child symbols hidden or missing when the VS Code symbol provider was still warming up.
- Fixed symbol expansion being incorrectly marked as complete when no symbols were returned immediately.
- Fixed transient symbol provider failures making files permanently behave like leaf nodes.
- Fixed node expansion failures caused by unsupported `SymbolInformation[]` responses from some language providers.
- Fixed node-limit handling during symbol expansion so incomplete expansions are detected and reported instead of silently stopping.
- Fixed recursive child expansion so hitting the node limit correctly cancels the remaining expansion path.
- Fixed Markdown files causing excessive heading expansion by keeping `.md` and `.markdown` files collapsed.
- Fixed dependency edges being treated as child edges during collapse and traversal operations.

## [0.2.1] - 2026-03-30

### New Features

- Added a new **Error/Warning Highlighting** section in Settings with an enable/disable toggle.
- Added diagnostic color mode for code-backed nodes:
  - **Red** when one or more errors are present.
  - **Yellow** when warnings exist and errors do not.
  - **Green** when no warnings/errors are present.
- Added symbol-level diagnostic coloring by matching diagnostics to child symbol ranges.

### Improvements

- Diagnostic highlighting now overrides all other color systems while enabled (debug, active mode, breakpoints, hover dimming, and custom color rules).
- Non-code nodes remain neutral gray in diagnostic mode for clearer focus.

## [0.2.0] - 2026-03-30

### New Features

- Added **Animate Mode** controls in Settings:
  - **Depth** input to control expansion depth.
  - **Pop Speed** slider to control animation speed only.
- Added staged expansion animation for project exploration:
  - Children pop from parent position in sequence.
  - Supports folders and code files (symbol children such as methods, functions, attributes).
- Added **ESC cancel** during animation:
  - Shows bottom-left `Cancelling...` status.
  - Restores pre-animation expanded state and camera view.

### Improvements

- Reworked graph updates to avoid full reset on expansion (reduced jitter significantly).
- Improved non-animated node expansion to preserve current positions.
- Updated settings panel visuals with cleaner modern styling and fixed layout issues.
- Fixed settings close button sizing and filter textarea overflow behavior.

## [0.1.6] - 2026-03-30

### New Features

- Added keyboard shortcut **P** to pause/resume graph physics simulation while preserving graph interaction (drag, zoom, click).
- Hover popups now include a **4-line code snippet** with line numbers for source-backed symbol nodes.

### Improvements

- Reduced hover jitter by skipping forced color refresh on nodes with no children.
- Removed keyboard focus outline artifacts (yellow border) in webview interactions.

## [0.1.5] - 2025-12-17

### Improvements

- **Hover Info Popup**: Fixed popup positioning to appear next to the hovered node on the canvas instead of the center of the screen

## [0.1.4] - 2025-12-17

### Overview

Add hover information popup for nodes displaying code metrics and diagnostics.

### New Features

- **Hover Info Popup**: Hover over any node for ~500ms to see a popup with code information including variable count, method count, warnings, and errors
- Popup is non-intrusive and disappears when you move away or interact with nodes

### Maintenance

- Bumped extension version to 0.1.4

## [0.1.3] - 2025-12-15

### Overview

Add a toggle to control active debug highlighting so paused call stack and symbol colors can be turned off when you want a cleaner view. Additionally added QOL aesthetic fixes.

### New Features

- Added **Active Debug Highlight** toggle in the webview settings (General) to enable/disable paused call stack and symbol highlighting. Additionally shows the latest order of the call stack.
- Debug highlight colors now respect the toggle state when rendering the graph.
- When hovered, nodes now highlight themselves and child nodes.
- Add line thickness adjustment slider

### Maintenance

- Bumped extension version to 0.1.3 and refreshed release assets.

## [0.1.0] - 2025-12-14

### Overview

First public release of Vizual, an interactive project graph visualizer for VS Code.

### New Features

- Interactive graph: expand folders → files → symbols (classes, functions, methods, variables)
- Smart navigation: click to expand; Ctrl+Click to open files or jump to symbols
- Physics controls: adjustable center force, link force, and link length
- Color rules: customize colors by node kind and file extension
- Filtering: include/exclude glob patterns, max depth, node limits
- Active Mode: dims non-active nodes; highlights active file (green) and breakpoints (red)
- Root pinning: keeps the root node anchored to prevent graph drift

### Performance

- Stabilization for faster layout
- Tuned physics (damping 0.65, minVelocity 0.05) for smoother ease-out
- Reduced central gravity intensity to avoid over-clustering

### Improvements

- Toggle expand/collapse on node click
- Distinct shapes for folders, files, classes, functions, methods, variables, interfaces, enums
- Live breakpoint and active file tracking

### Requirements

- VS Code 1.107.0+
- Node.js 22.x+

### Known Issues

- Large projects may hit the node cap; increase limit in Filters
- Symbol coverage depends on installed language extensions

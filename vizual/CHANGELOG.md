# Change Log

All notable changes to the "vizual" extension will be documented in this file.

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
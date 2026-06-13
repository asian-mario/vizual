# Vizual

**An interactive node-graph visualizer for VS Code projects**

![Logo](./media/Vizual.png)

![Demo](./media/demo.gif)
Download: [vizual-0.2.1.vsix](./Releases/vizual-0.2.2.vsix)

An interactive VS Code extension that visualizes your project structure as a node graph, showing folders, files, and code symbols (classes, functions, methods, etc.).

![Release](https://img.shields.io/badge/Release-v0.2.2-blue)

## Features

### Interactive Graph Exploration

- **Incremental Expansion**: Click folders to reveal files, click files to show symbols (classes, functions, variables)
- **Physics-Based Layout**: Nodes move naturally with Obsidian-style physics simulation
- **Smart Navigation**: Ctrl+Click any node to open it in your editor with precise symbol positioning

### Customizable Visualization

- **Node Shapes**: Different shapes for files, folders, classes, functions, methods, variables, and more
- **Color Rules**: Configure colors by node kind and file extension
- **Physics Controls**: Adjust center force, link force, and link length to your preference
- **Physics Pause Shortcut**: Press **P** to pause/resume simulation while still interacting with the graph
- **Animate Mode**: Expand from root using **Depth** and **Pop Speed** controls
- **ESC Cancel**: Cancel animation and restore the pre-animation graph state/camera
- **Error/Warning Highlighting**: Toggle diagnostic mode to color code-backed nodes by severity (red error, yellow warning, green clean), while non-code nodes stay gray

### Rich Hover Context

- **4-Line Snippet Preview**: Hover a source-backed child/symbol node to see the first 4 lines with line numbers
- **Code-at-a-Glance**: Read quick context without opening the file immediately

### Powerful Filtering

- **Glob Patterns**: Include/exclude files and folders using glob patterns
- **Max Depth**: Limit graph depth to focus on specific areas
- **Node Cap**: Performance safety with configurable node limits

### Debug-Aware

- **Active Mode**: Dims inactive files to highlight your current context
- **Breakpoint Highlighting**: Files with breakpoints are shown in red
- **Active File Tracking**: Currently open file is highlighted in green

## Installation

### From VSIX (Local Testing)

1. Download the latest `.vsix` file from releases
2. Open VS Code
3. Press `Ctrl+Shift+P` and run "Extensions: Install from VSIX..."
4. Select the downloaded `.vsix` file

### From Marketplace

Search for "Vizual" (publisher: `asian-mario`) in the VS Code Extensions marketplace

## Usage

### Opening the Graph

1. Open your project in VS Code
2. Press `F1` or `Ctrl+Shift+P`
3. Type and select **"Vizual: Open Project Graph"**

### Navigating

- **Left-click folder/file node**: Expand/collapse its contents
- **Ctrl+Left-click node**: Open the file or jump to symbol in editor
- **Drag nodes**: Rearrange the graph manually
- **Zoom**: Mouse wheel to zoom in/out
- **Pan**: Click and drag empty space
- **Press P**: Pause/resume physics simulation

### Animation Mode

1. Open **Settings**.
2. Set **Depth** (how many levels to expand from root).
3. Set **Pop Speed** (`0.5x` to `2.0x`) to control pop timing.
4. Click **Animate**.
5. Press **ESC** while animating to cancel and restore your previous graph state.

Animation notes:

- Animation collapses back to root before playback for consistent sequencing.
- Children pop sequentially from their parent node (including symbol children for code files).
- Pop Speed affects animation mode only.

### Customizing

Click the **Settings** icon in the toolbar to access:

- **Physics Controls**: Adjust how nodes move and attract each other
- **Filters**: Include/exclude patterns, max depth, node limits
- **Colors**: Customize colors for different node types

### Active Mode

Enable **Active Mode** to focus on your current work:

- Your active file is highlighted in **green**
- Files with breakpoints are highlighted in **red**
- All other nodes are dimmed to **gray**

### Error/Warning Highlighting

Enable **Error/Warning Highlighting** in **Settings** to temporarily override node colors using diagnostics:

- **Red**: Node has at least one error
- **Yellow**: Node has warning(s) and no errors
- **Green**: Node has no warnings/errors
- **Gray**: Non-code nodes/files

Notes:

- This mode overrides debug, active, breakpoint, hover, and custom color rules while enabled.
- Symbol children are colored from diagnostics in their own code range, so child severity is shown directly.

## Configuration

Settings are stored per-workspace and persist across sessions:

```json
{
  "vizual.centerForce": 0.05,
  "vizual.linkForce": 0.03,
  "vizual.linkLength": 180,
  "vizual.maxDepth": 5,
  "vizual.maxNodes": 500,
  "vizual.includePatterns": ["**/*"],
  "vizual.excludePatterns": ["**/node_modules/**", "**/.git/**"]
}
```

## Node Types & Shapes

| Type      | Shape      | Description         |
| --------- | ---------- | ------------------- |
| Folder    | 📁 Box     | Directory nodes     |
| File      | 📄 Dot     | File nodes          |
| Class     | ⬟ Hexagon  | Class definitions   |
| Function  | ⭐ Star    | Top-level functions |
| Method    | 🔷 Diamond | Class methods       |
| Variable  | ⏹ Square   | Variables/constants |
| Interface | △ Triangle | Interfaces          |
| Enum      | △ Triangle | Enumerations        |

## Development

### Prerequisites

- Node.js 22.x or higher
- VS Code 1.107.0 or higher

### Building from Source

```bash
git clone https://github.com/yourusername/vizual.git
cd vizual/vizual
npm install
npm run compile
```

### Running in Development

1. Open the `vizual/vizual` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. In the new window, run "Vizual: Open Project Graph"

### Testing Changes

```bash
npm run watch    # Auto-compile on file changes
npm run lint     # Check code style
npm run test     # Run unit tests
```

## Architecture

Vizual is built with:

- **Extension Host (TypeScript)**: File system scanning, symbol extraction via VS Code API, breakpoint tracking
- **Webview (JavaScript)**: Graph rendering with [vis-network](https://visjs.github.io/vis-network/), physics simulation, user interactions
- **Message Protocol**: Bidirectional communication for graph updates, expansion, navigation, and settings

## Roadmap

- [ ] Import/dependency edge visualization
- [ ] Multi-root workspace support
- [ ] Call graph and reference tracking
- [ ] Custom color themes
- [ ] Export graph as image
- [ ] Search and filter UI enhancements

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the terms found in [LICENSE.md](LICENSE.md).

## Credits

Built with:

- [vis-network](https://visjs.github.io/vis-network/) for graph visualization
- [VS Code Extension API](https://code.visualstudio.com/api)

---

**Tip**: For best results, enable Active Mode while debugging to keep your focus on the files that matter!

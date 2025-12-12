# Vizual - Project Graph Visualizer

An interactive VS Code extension that visualizes your project structure as a node graph, showing folders, files, and code symbols (classes, functions, methods, etc.).

## Features

- **Interactive Node Graph**: Visualize your project structure with an expandable, hierarchical graph
- **Multi-Level Exploration**: 
  - Expand folders to see files
  - Expand files to see symbols (classes, functions, methods, variables, etc.)
- **Smart Navigation**: 
  - Click nodes to expand them
  - Ctrl+Click to open files/symbols in the editor
- **Filtering**: Configure include/exclude patterns, max depth, and node limits
- **Color Coding**: Customize colors by node type (folder, file, class, function, etc.)
- **Debug Integration**: 
  - Highlights files with breakpoints
  - Shows currently active file
  - Active Mode to dim non-active nodes
- **Powered by vis-network**: Fast and responsive graph rendering

## Usage

1. Open a workspace/folder in VS Code
2. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
3. Run: `Vizual: Open Project Graph`
4. The graph panel will open showing your project root
5. Click nodes to expand folders or files
6. Ctrl+Click to open files or navigate to symbols

## Controls

- **Change Root**: Select a different root folder for the graph
- **Active Mode**: Toggle to highlight only active files and files with breakpoints
- **Filters**: Configure include/exclude patterns and limits
  - Include patterns (glob)
  - Exclude patterns (glob) - defaults exclude node_modules, .git, dist, etc.
  - Max depth
  - Max nodes (safety limit)
- **Colors**: Customize node colors by type

## Graph Interactions

- **Single Click**: Expand a folder or file node
- **Ctrl+Click**: 
  - Folder: Reveal in Explorer
  - File: Open in editor
  - Symbol: Open file and jump to symbol location

## Node Types

- **Folders**: Yellow boxes (expandable)
- **Files**: Blue ellipses (expandable to show symbols)
- **Classes**: Green diamonds
- **Functions/Methods**: Purple/Yellow dots
- **Variables**: Orange dots
- **And more**: Interfaces, enums, namespaces, properties, etc.

## Default Excludes

By default, these patterns are excluded:
- `**/node_modules/**`
- `**/.git/**`
- `**/dist/**`
- `**/out/**`
- `**/*.map`

You can modify these in the Filters panel.

## Requirements

- VS Code 1.107.0 or higher

## Extension Settings

This extension currently has no settings in VS Code settings. Configuration is done through the webview UI.

## Known Issues

- Large projects may hit the node limit (default 1000 nodes) - increase in Filters if needed
- Symbol expansion depends on language support installed in VS Code

## Development

To work on this extension:

1. Clone the repository
2. Run `npm install`
3. Press `F5` to open Extension Development Host
4. Run the command `Vizual: Open Project Graph`

## Release Notes

### 0.0.1

Initial release:
- Basic folder/file/symbol graph visualization
- Interactive expansion
- Filtering and color rules
- Breakpoint and active file highlighting
- Active mode

## License

See [LICENSE.md](LICENSE.md)

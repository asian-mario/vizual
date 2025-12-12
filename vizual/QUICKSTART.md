# Quick Start Guide

## Running the Extension in Development

1. **Open the project in VS Code**
   ```
   Open folder: d:\Big Projects\vizual\vizual
   ```

2. **Install dependencies** (if not already done)
   ```
   npm install
   ```

3. **Compile the extension**
   ```
   npm run compile
   ```
   Or use watch mode for automatic recompilation:
   ```
   npm run watch
   ```

4. **Start Extension Development Host**
   - Press `F5` in VS Code
   - This opens a new VS Code window with the extension loaded

5. **Test the extension**
   - In the Extension Development Host window, open any workspace/folder
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type: "Vizual: Open Project Graph"
   - Press Enter

6. **Interact with the graph**
   - Click on nodes to expand folders/files
   - Ctrl+Click to open files or jump to symbols
   - Use the controls at the top to:
     - Change root folder
     - Toggle active mode
     - Configure filters
     - Customize colors

## Project Structure

```
src/
├── extension.ts              # Entry point
├── graph/                    # Core logic
│   ├── types.ts             # Type definitions
│   ├── model.ts             # State management
│   ├── scanner.ts           # File system scanner
│   ├── symbolProvider.ts    # Symbol extraction
│   ├── debugTracker.ts      # Debug state tracking
│   └── controller.ts        # Main controller
└── webview/                 # UI
    ├── panel.ts             # Webview manager
    └── media/
        ├── main.js          # Frontend logic
        └── style.css        # Styling
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run compile` | Build the extension once |
| `npm run watch` | Build and watch for changes |
| `npm run lint` | Run ESLint |
| `F5` | Start debugging |

## Troubleshooting

### Extension doesn't activate
- Check the Output panel (View → Output → Extension Host)
- Look for any error messages

### Graph doesn't show
- Ensure you have a workspace/folder open
- Check the Developer Tools (Help → Toggle Developer Tools)
- Look for errors in the Console

### Symbols don't expand
- Ensure you have the appropriate language extension installed
- Try with a TypeScript/JavaScript file first (built-in support)

### Changes not reflecting
- Make sure `npm run watch` is running
- Reload the Extension Development Host window (`Ctrl+R`)

## Testing Changes

After making code changes:

1. If watch mode is running, code will auto-compile
2. Reload the Extension Development Host window (`Ctrl+R`)
3. Re-run the command "Vizual: Open Project Graph"

## Building for Production

```bash
npm run package
```

This creates an optimized build in `dist/extension.js`.

## Common Use Cases

### Exploring a New Codebase
1. Open the project
2. Run "Vizual: Open Project Graph"
3. Click through folders to understand structure
4. Expand key files to see their symbols
5. Ctrl+Click to jump to important functions/classes

### Finding Code with Breakpoints
1. Set some breakpoints in your code
2. Open the graph
3. Look for red nodes (files with breakpoints)
4. Use Active Mode to focus only on files with breakpoints

### Navigating Large Projects
1. Use filters to exclude build artifacts and dependencies
2. Adjust max nodes if needed
3. Expand only the areas you're interested in
4. Use Ctrl+Click to quickly jump to files/symbols

## Next Steps

- Test the extension with different project types
- Try expanding files in different languages
- Test filter patterns
- Customize color rules
- Set breakpoints and verify highlighting
- Switch between files and check active highlighting

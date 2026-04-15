# Project Design Planner

A VS Code-native planning workspace with free-form Markdown docs, graph-based design artifacts, and a standalone MCP server for agent access.

## Monorepo layout

- `apps/vscode-extension`: VS Code extension host plus React webview planner
- `packages/planner-core`: shared storage, graph models, compiler, and file helpers
- `packages/mcp-server`: stdio MCP server built on `planner-core`

## Prerequisites

- Node.js 20+
- npm 10+
- VS Code 1.105+

## Install and validate

```bash
npm install
npm run typecheck
npm run test
npm run build
```

## Extension development

The extension is bundled into `apps/vscode-extension/dist` and the webview is bundled into `apps/vscode-extension/dist/webview`.

### Fast iteration loop

Start the extension and webview watchers:

```bash
npm run watch -w apps/vscode-extension
```

Then launch the Extension Development Host in one of two ways:

1. Open this repo in VS Code and run the `Project Design Planner: Extension Development Host` launch configuration.
2. Or start it from the terminal:

```bash
code --extensionDevelopmentPath="$(pwd)/apps/vscode-extension" "$(pwd)"
```

Inside the Extension Development Host, run the `Project Design Planner: Open Planner` command from the command palette.

### One-off build

```bash
npm run build -w apps/vscode-extension
```

## Package the extension

Build and package a local VSIX:

```bash
npm run package:vsix -w apps/vscode-extension
```

That writes `apps/vscode-extension/dist/project-design-planner.vsix`.

Install it in VS Code with `Extensions: Install from VSIX...`.

## Manual verification checklist

Use this after launching the Extension Development Host:

1. Run `Project Design Planner: Open Planner`.
2. Confirm `.project-docs/` is created in the workspace if it does not already exist.
3. Create a Markdown doc, edit it, save it, and verify the file appears under `.project-docs/`.
4. Create a graph, add nodes and edges, move them around, save, and reopen to confirm the layout persists.
5. Add a group frame and a comment sticky note, save, reload, and confirm both render correctly.
6. Run `Compile Context` and verify the generated bundle/summary reflects the current docs and graphs.
7. Archive and restore an entry to confirm the tree updates without a reload.

## Extension-specific notes

More detailed extension packaging and development notes live in [`apps/vscode-extension/README.md`](./apps/vscode-extension/README.md).

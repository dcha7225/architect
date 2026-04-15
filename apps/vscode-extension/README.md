# Project Design Planner VS Code Extension

## What this package contains

This workspace package bundles two pieces together:

- the VS Code extension host entrypoint in `dist/extension.js`
- the React webview bundle in `dist/webview`

Both are built from this package and packaged together into the VSIX.

## Local development

From the monorepo root, install dependencies once:

```bash
npm install
```

### Watch mode

Run the extension and webview builders in watch mode:

```bash
npm run watch -w apps/vscode-extension
```

This keeps `dist/extension.js` and `dist/webview/*` up to date while you work.

### Launching the Extension Development Host

Option 1:

- Open the monorepo in VS Code.
- Run the `Project Design Planner: Extension Development Host` launch configuration from the Run and Debug panel.

Option 2:

```bash
code --extensionDevelopmentPath="$(pwd)/apps/vscode-extension" "$(pwd)"
```

Once the Extension Development Host opens:

1. Open the command palette.
2. Run `Project Design Planner: Open Planner`.
3. Work inside the planner against the current workspace's `.project-docs/` folder.

## Packaging a VSIX

Build and package the extension:

```bash
npm run package:vsix -w apps/vscode-extension
```

The packaged file is written to:

```text
apps/vscode-extension/dist/project-design-planner.vsix
```

To install it locally:

1. Open VS Code.
2. Run `Extensions: Install from VSIX...`.
3. Choose `apps/vscode-extension/dist/project-design-planner.vsix`.

## Suggested smoke test

Run this sequence before sharing a build:

1. Launch the Extension Development Host.
2. Open the planner.
3. Create and save a Markdown planning doc.
4. Create and save a graph with at least one node, one edge, one group, and one comment.
5. Refresh the entry, or reopen the planner tab, and confirm the graph layout persists.
6. Compile context and confirm both the Markdown doc and the graph show up in the output.
7. Archive and restore one entry.

## Packaging notes

- The extension is bundled, so source files and `node_modules` are excluded from the packaged VSIX.
- Packaging depends on the generated `dist/` output, so `package:vsix` always runs a fresh build first.

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

## Pilot setup guide (end-to-end)

Use this checklist when onboarding a pilot user who should not run any build steps locally.

### 1) Build and generate the VSIX (developer only)

From the repo root:

```bash
npm install
npm run package:vsix -w apps/vscode-extension
```

This generates:

`apps/vscode-extension/dist/project-design-planner.vsix`

### 2) Share the VSIX with pilot users

Distribute `project-design-planner.vsix` via your normal release channel (artifact store, shared drive, GitHub release asset, etc.).

### 3) Install the extension from VSIX (pilot user)

In VS Code:

1. Open command palette
2. Run `Extensions: Install from VSIX...`
3. Select `project-design-planner.vsix`
4. Reload VS Code when prompted

Pilot users do **not** need `npm install` or `npm run build`.

### 4) Open the target project workspace

Open the project where planner data should live. The planner will store artifacts in:

`<workspace-root>/.project-docs/`

### 5) Launch planner once

Run:

`Project Design Planner: Open Planner`

Confirm `.project-docs/` is created in the opened workspace.

### 6) Generate Claude Code MCP config

Run:

`Project Design Planner: Copy MCP Config for Claude Code`

This copies a ready-to-paste MCP snippet pointing at the extension-bundled server:

`.../dist/mcp-server.js`

and the currently opened workspace path via `--workspace`.

### 7) Add the config to Claude Code

Paste the copied snippet into:

- project-local `.mcp.json` (recommended), or
- global Claude settings

### 8) Restart Claude Code / verify MCP connection

Restart Claude Code (or run `/mcp`) and confirm `project-design-planner` is connected.

### 9) Run a write-path smoke test

Ask Claude Code to:

1. `create_doc` with path `notes/pilot-check`
2. `list_entries`
3. `get_entry` for `notes/pilot-check.md`

Then verify the file exists at:

`<workspace-root>/.project-docs/notes/pilot-check.md`

and not in any unrelated repo.

### 10) Compile smoke test

Ask Claude Code to run `compile_context` and verify it returns both:

- `bundle` (structured JSON context)
- `summary` (human-readable markdown)

## Connecting AI agents via MCP

The extension ships a bundled MCP server at `apps/vscode-extension/dist/mcp-server.js`. AI agents (Claude Code, Cursor, etc.) connect to it over stdio to read and write planning artifacts in `.project-docs/`.

### Quick setup with Claude Code

1. Build the extension (which bundles the MCP server):

```bash
npm run build
```

2. From VS Code, run the command palette action **Project Design Planner: Copy MCP Config for Claude Code**. This copies a ready-to-paste JSON snippet with the correct server path and workspace root to your clipboard.

3. Paste the config into `.mcp.json` at the root of your project (or into your global Claude Code settings at `~/.claude.json`):

```json
{
  "mcpServers": {
    "project-design-planner": {
      "command": "node",
      "args": [
        "<path-to-extension>/dist/mcp-server.js",
        "--workspace",
        "<path-to-your-project>"
      ]
    }
  }
}
```

4. Restart Claude Code (or run `/mcp` to verify the server is connected). You should see `project-design-planner` listed with 10 tools.

### Available MCP tools

| Tool | Purpose |
|------|---------|
| `list_entries` | Discover all docs, graphs, and folders in the workspace |
| `get_entry` | Read full content of a doc or graph |
| `create_doc` | Create a new Markdown planning doc |
| `create_graph` | Create a new graph design artifact with nodes and edges |
| `update_doc` | Replace a doc's Markdown content (full overwrite) |
| `update_graph` | Replace a graph's nodes and edges (full overwrite) |
| `move_entry` | Rename or move an entry |
| `archive_entry` | Soft-delete an entry |
| `restore_entry` | Restore an archived entry |
| `compile_context` | Compile all docs and graphs into a structured agent context bundle |

### Smoke test

Ask Claude Code:

> "Use the project design planner to list all entries and then compile the workspace context."

It should call `list_entries` then `compile_context` and return results from your `.project-docs/` folder.

### Workspace resolution

The MCP server determines where `.project-docs/` lives using this priority:

1. `--workspace /path/to/project` CLI flag (recommended, used by the Copy MCP Config command)
2. `PLANNER_WORKSPACE` environment variable
3. Current working directory (fallback)

## Manual verification checklist

Use this after launching the Extension Development Host:

1. Run `Project Design Planner: Open Planner`.
2. Confirm `.project-docs/` is created in the workspace if it does not already exist.
3. Create a Markdown doc, edit it, save it, and verify the file appears under `.project-docs/`.
4. Create a graph, add nodes and edges, move them around, save, and reopen to confirm the layout persists.
5. Run `Compile Context` and verify the generated bundle/summary reflects the current docs and graphs.
6. Archive and restore an entry to confirm the tree updates without a reload.
7. Run `Project Design Planner: Copy MCP Config for Claude Code` and verify the clipboard contains valid JSON with the correct paths.

## Extension-specific notes

More detailed extension packaging and development notes live in [`apps/vscode-extension/README.md`](./apps/vscode-extension/README.md).

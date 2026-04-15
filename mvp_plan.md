# Project Design Planner MVP

## Summary

Build a TypeScript npm-workspaces monorepo with three parts: a VS Code extension with a React Webview planner, a shared `planner-core` package, and a standalone stdio MCP server. The planner is a free-form design workspace centered on easy access, editing, and persistence of planning artifacts under `.project-docs/`, with two first-class artifact types:

- Markdown planning docs for narrative notes, specs, and decisions
- Graph design artifacts for higher-level system modeling beyond plain text

Graphs are first-class, app-managed artifacts edited visually in the UI. Agents consume the workspace through MCP and can request a compiled context bundle that translates docs + graphs into an agent-friendly structured output plus a readable summary.

## UI And UX

- The webview is a unified planner app with:
    - Left tree for all entries under `.project-docs/`, including nested folders, docs, graphs, and archived items.
    - Center workspace with tabs for multiple open entries.
    - Right inspector for metadata, graph properties, links, and compile annotations.
- Entry types:
    - `Doc`: Markdown editor with preview toggle, frontmatter-backed metadata, explicit `Save` and `Revert`.
    - `Graph`: free-form canvas with pan/zoom, nodes, edges, groups, comments, colors, labels, arbitrary metadata, and links to docs or other graphs.
- Graph editing model:
    - Canvas is intentionally unconstrained; users can model architecture, requirements, decisions, workflows, or any custom concept.
    - Nodes, edges, and groups support optional semantic annotations in the inspector such as `kind`, `role`, `constraint`, `decision`, `interface`, `priority`, or arbitrary user-defined keys.
    - These annotations are optional and exist only to improve compiler output; they do not restrict editing.
- Planner actions:
    - `New Doc`, `New Graph`, `New Folder`, `Rename`, `Move`, `Duplicate`, `Archive`, `Restore`.
    - `Compile Context` for current entry, selected entries, or the entire workspace.
- External change behavior:
    - The extension watches `.project-docs/`.
    - If a file changes on disk while open, show `Reload from Disk` or `Keep Editing`.
    - If the user saves after an external change, last write wins.

## Artifact Model And MCP APIs

- Storage:
    - Docs: `.md` files with optional YAML frontmatter.
    - Graphs: app-managed `.planner-graph.json` files; users primarily edit them through the planner UI, not by hand.
    - Archived entries live under `.project-docs/.archive/`.
- Managed metadata:
    - Docs: `title`, `tags`, `summary`, `updatedAt`, plus arbitrary extra keys.
    - Graphs: `title`, `tags`, `summary`, `updatedAt`, canvas state, nodes, edges, groups, and arbitrary extra metadata.
- Graph schema:
    - `nodes[]`: `id`, `label`, `position`, optional `body`, optional `metadata`, optional `annotations`
    - `edges[]`: `id`, `source`, `target`, optional `label`, optional `metadata`, optional `annotations`
    - `groups[]`: `id`, `label`, `memberIds`, optional `metadata`, optional `annotations`
- MCP surface:
    - `list_entries(includeArchived?)`
    - `get_entry(path, includeArchived?)`
    - `create_doc(path, content?, metadata?)`
    - `create_graph(path, graph?)`
    - `update_doc(path, content, metadata?)`
    - `update_graph(path, graph)`
    - `move_entry(path, newPath)`
    - `archive_entry(path)`
    - `restore_entry(path, restorePath?)`
    - `compile_context(entryPaths?)`
- `compile_context` behavior:
    - Accepts an optional set of paths; defaults to all active entries.
    - Returns:
        - `bundle`: structured agent context with extracted entities, relationships, constraints, decisions, requirements, flows, open questions, and source references
        - `summary`: human-readable Markdown synopsis of the same context
    - Compilation uses optional graph annotations when present and otherwise falls back to heuristics from labels, notes, links, and connected structure.
    - Compiled output is generated on demand and not persisted by default.

## Implementation Changes

- `apps/vscode-extension`:
    - Extension host manages file IO and workspace watching.
    - React webview uses Monaco for Markdown editing and React Flow or equivalent for the graph canvas.
    - Typed message RPC connects the webview to the extension host.
- `packages/planner-core`:
    - Markdown/frontmatter parsing and serialization.
    - Graph model types and validation for the app-managed graph format.
    - Safe path resolution, tree indexing, archive/restore helpers, metadata normalization, and atomic write helpers.
    - Context compiler that merges docs and graph artifacts into the agent bundle + summary.
- `packages/mcp-server`:
    - Stdio MCP server exposing the generic entry APIs and compiler API.
    - Reuses `planner-core` so UI and agents read/write/compile identically.
- Persistence behavior:
    - All writes use atomic temp-file + rename semantics.
    - Concurrency is intentionally last-write-wins; there is no locking or conflict rejection in MVP.

## Test Plan

- Unit tests in `planner-core`:
    - Markdown/frontmatter parse and serialize.
    - Graph file validation and round-trip persistence.
    - arbitrary metadata preservation.
    - safe path enforcement for nested folders.
    - archive/restore behavior.
    - atomic write behavior and temp-file cleanup.
    - compiler output from docs only, graphs only, and mixed workspaces.
- Integration tests:
    - extension can create/edit/save/move/archive/restore docs and graphs.
    - graph canvas state persists and reloads accurately.
    - MCP stdio tests cover all entry CRUD operations plus `compile_context`.
    - extension and MCP server interoperate through the same on-disk workspace.
- Key scenarios:
    - import existing Markdown docs with no frontmatter.
    - create a graph, annotate some nodes, and compile context.
    - compile an unannotated free-form graph and verify heuristic output is still usable.
    - archive and restore entries with path collisions.
    - simultaneous saves from UI and agent where latest save wins.
    - interrupted write does not corrupt the prior file.

## Assumptions And Defaults

- MVP supports one workspace folder only.
- The planner is intentionally free-form: there are no required doc types and no fixed planning taxonomy.
- Higher-order design comes from first-class graph artifacts, not from forcing users into rigid document schemas.
- Graph compilation is assistive, not authoritative; source artifacts remain the docs and graphs themselves.
- Archive is the MVP delete model; permanent delete can be added later.

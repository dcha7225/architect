import {
  archiveEntry,
  compileContext,
  createDoc,
  createGraph,
  getEntry,
  graphToPayload,
  initializeProjectDocs,
  listEntries,
  moveEntry,
  restoreEntry,
  updateDoc,
  updateGraph,
} from "@project-design-planner/planner-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { PlannerEntry } from "@project-design-planner/planner-core";

const metadataInputSchema = z
  .object({
    title: z.string().optional().describe("Human-readable title for the entry."),
    tags: z.array(z.string()).optional().describe("Categorization tags, e.g. ['architecture', 'v2']."),
    summary: z.string().optional().describe("One-line summary of the entry's purpose."),
  })
  .catchall(z.unknown())
  .describe("Entry metadata. title, tags, and summary are standard; extra keys are preserved.");

const graphNodeInputSchema = z
  .object({
    id: z.string().min(1).describe("Unique node identifier, e.g. 'api-gateway'."),
    label: z.string().min(1).describe("Display name shown on the node."),
    position: z
      .object({
        x: z.number().describe("Horizontal canvas position in pixels."),
        y: z.number().describe("Vertical canvas position in pixels."),
      })
      .describe("Canvas position. Space nodes ~200-250px apart for readability."),
    body: z.string().optional().describe("Optional longer description shown below the label."),
    color: z.string().optional().describe("CSS color for the node border, e.g. '#6dd3a8'."),
    metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary key-value metadata."),
    annotations: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Semantic annotations that improve compile_context output. Common keys: kind (component | service | database | api | queue | agent), role, constraint, priority.",
      ),
    links: z
      .array(z.string())
      .optional()
      .describe("Paths to related docs or graphs, e.g. ['notes/api-spec.md']."),
  })
  .describe("A node in the graph canvas representing a component, concept, or design element.");

const graphEdgeInputSchema = z
  .object({
    id: z.string().min(1).describe("Unique edge identifier, e.g. 'edge-api-to-db'."),
    source: z.string().min(1).describe("ID of the source node."),
    target: z.string().min(1).describe("ID of the target node."),
    label: z.string().optional().describe("Relationship label shown on the edge, e.g. 'calls', 'depends on'."),
    color: z.string().optional().describe("CSS color for the edge stroke."),
    metadata: z.record(z.string(), z.unknown()).optional(),
    annotations: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Semantic annotations. Common keys: kind (dependency | dataflow | calls | triggers)."),
  })
  .describe("A directed edge connecting two nodes.");

const graphInputSchema = z
  .object({
    version: z.number().int().positive().optional().describe("Schema version. Always 1 for now."),
    metadata: metadataInputSchema.optional().describe("Graph-level metadata (title, tags, summary)."),
    viewport: z
      .object({
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
      })
      .optional()
      .describe("Saved canvas viewport. Omit to use defaults."),
    nodes: z.array(graphNodeInputSchema).optional().describe("Array of graph nodes."),
    edges: z.array(graphEdgeInputSchema).optional().describe("Array of directed edges between nodes."),
  })
  .describe("A planner graph artifact with nodes, directed edges, and metadata.");

function serializeResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toEntryPayload(entry: PlannerEntry): unknown {
  if (entry.kind === "doc") {
    return {
      kind: "doc",
      path: entry.path,
      title: entry.title,
      summary: entry.summary,
      metadata: entry.metadata,
      content: entry.content,
      revision: entry.revision,
      archived: entry.archived,
    };
  }

  if (entry.kind === "graph") {
    return {
      ...graphToPayload(entry),
      archived: entry.archived,
    };
  }

  return entry;
}

export function createPlannerMcpServer(workspaceRoot: string): McpServer {
  const server = new McpServer({
    name: "project-design-planner",
    version: "0.1.0",
  });

  const withWorkspace = async <T>(fn: () => Promise<T>): Promise<T> => {
    await initializeProjectDocs(workspaceRoot);
    return fn();
  };

  server.registerTool(
    "list_entries",
    {
      description:
        "List all planning docs, graph artifacts, and folders in the .project-docs/ workspace. " +
        "Returns an array of entry summaries with path, kind (doc | graph | folder), title, summary, tags, and updatedAt. " +
        "Call this first to discover what exists before reading or updating entries.",
      inputSchema: {
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include entries under .archive/. Defaults to false."),
      },
    },
    async ({ includeArchived }) => {
      const result = await withWorkspace(() => listEntries(workspaceRoot, { includeArchived }));
      return serializeResult({ entries: result });
    },
  );

  server.registerTool(
    "get_entry",
    {
      description:
        "Read the full content of a planning entry. " +
        "For docs: returns the full Markdown content, metadata (title, tags, summary), and revision. " +
        "For graphs: returns the full graph object with nodes (id, label, position, body, annotations) and edges (id, source, target, label, annotations). " +
        "Use list_entries first to discover available paths.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Entry path relative to .project-docs/, e.g. 'notes/api-spec.md' or 'architecture.planner-graph.json'."),
        includeArchived: z.boolean().optional().describe("Allow reading archived entries. Defaults to false."),
      },
    },
    async ({ path, includeArchived }) => {
      const result = await withWorkspace(() => getEntry(workspaceRoot, path, includeArchived));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "create_doc",
    {
      description:
        "Create a new Markdown planning doc. The .md extension is added automatically if omitted. " +
        "Nested paths like 'notes/api-spec' create intermediate folders. " +
        "Returns the created entry with its resolved path and metadata.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Entry path relative to .project-docs/, e.g. 'notes/api-spec'. The .md extension is added automatically."),
        content: z.string().optional().describe("Markdown body content. Defaults to empty."),
        metadata: metadataInputSchema.optional(),
      },
    },
    async ({ path, content, metadata }) => {
      const result = await withWorkspace(() => createDoc(workspaceRoot, path, content ?? "", metadata));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "create_graph",
    {
      description:
        "Create a new graph design artifact for modeling architecture, data flows, or system relationships. " +
        "The .planner-graph.json extension is added automatically if omitted. " +
        "If graph is omitted, an empty graph is created. " +
        "Returns the created entry with its resolved path and full graph data.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Entry path relative to .project-docs/, e.g. 'architecture' or 'designs/auth-flow'. Extension is added automatically.",
          ),
        graph: graphInputSchema.optional(),
      },
    },
    async ({ path, graph }) => {
      const result = await withWorkspace(() =>
        createGraph(workspaceRoot, path, graph as unknown as Parameters<typeof createGraph>[2]),
      );
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "update_doc",
    {
      description:
        "Replace the full Markdown content of an existing planning doc. " +
        "This is a full overwrite — not a patch. Pass the complete desired content. " +
        "Metadata fields are merged with existing metadata; omitted fields are preserved.",
      inputSchema: {
        path: z.string().min(1).describe("Path of the existing doc to update."),
        content: z.string().describe("Complete new Markdown content (replaces the entire body)."),
        metadata: metadataInputSchema
          .optional()
          .describe("Metadata fields to merge. Existing fields not included here are preserved."),
      },
    },
    async ({ path, content, metadata }) => {
      const result = await withWorkspace(() => updateDoc(workspaceRoot, path, content, metadata));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "update_graph",
    {
      description:
        "Replace the full graph data of an existing graph artifact. " +
        "This is a full overwrite — pass the complete graph with all nodes and edges. " +
        "To modify a graph: first get_entry to read the current state, edit the nodes/edges, then update_graph with the full result.",
      inputSchema: {
        path: z.string().min(1).describe("Path of the existing graph to update."),
        graph: graphInputSchema.describe("Complete replacement graph with all nodes and edges."),
      },
    },
    async ({ path, graph }) => {
      const result = await withWorkspace(() =>
        updateGraph(workspaceRoot, path, graph as unknown as Parameters<typeof updateGraph>[2]),
      );
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "move_entry",
    {
      description:
        "Rename or move a doc, graph, or folder to a new path within .project-docs/. " +
        "Both paths are relative to .project-docs/.",
      inputSchema: {
        path: z.string().min(1).describe("Current entry path."),
        newPath: z.string().min(1).describe("Desired new path."),
      },
    },
    async ({ path, newPath }) => {
      const result = await withWorkspace(() => moveEntry(workspaceRoot, path, newPath));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "archive_entry",
    {
      description:
        "Soft-delete a planning entry by moving it under .project-docs/.archive/. " +
        "Archived entries are excluded from list_entries and compile_context by default. " +
        "Use restore_entry to undo.",
      inputSchema: {
        path: z.string().min(1).describe("Path of the entry to archive."),
      },
    },
    async ({ path }) => {
      const result = await withWorkspace(() => archiveEntry(workspaceRoot, path));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "restore_entry",
    {
      description: "Restore a previously archived entry back into the active workspace.",
      inputSchema: {
        path: z.string().min(1).describe("Path of the archived entry, e.g. '.archive/old-plan.md'."),
        restorePath: z
          .string()
          .optional()
          .describe("Custom restore destination. If omitted, restores to the original location."),
      },
    },
    async ({ path, restorePath }) => {
      const result = await withWorkspace(() => restoreEntry(workspaceRoot, path, restorePath));
      return serializeResult({ entry: toEntryPayload(result) });
    },
  );

  server.registerTool(
    "compile_context",
    {
      description:
        "Compile planning docs and graphs into a structured context bundle for agent consumption. " +
        "Returns a bundle with: documents (full content), graphs (nodes + edges), extracted entities, " +
        "relationships, requirements, constraints, decisions, flows, and open questions. " +
        "Also returns a human-readable Markdown summary. " +
        "If entryPaths is omitted, compiles the entire workspace.",
      inputSchema: {
        entryPaths: z
          .array(z.string())
          .optional()
          .describe(
            "Specific entry paths to compile. If omitted, all active (non-archived) entries are included.",
          ),
      },
    },
    async ({ entryPaths }) => {
      const result = await withWorkspace(() => compileContext(workspaceRoot, { entryPaths }));
      return serializeResult(result);
    },
  );

  return server;
}

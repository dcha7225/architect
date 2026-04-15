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

const metadataInputSchema = z.record(z.string(), z.unknown());
const graphInputSchema = z.record(z.string(), z.unknown());

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
      description: "List planning docs, graph artifacts, and folders inside .project-docs.",
      inputSchema: {
        includeArchived: z.boolean().optional(),
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
      description: "Read a Markdown planning doc, graph artifact, or folder metadata from .project-docs.",
      inputSchema: {
        path: z.string().min(1),
        includeArchived: z.boolean().optional(),
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
      description: "Create a new Markdown planning doc with optional metadata.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string().optional(),
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
      description: "Create a new app-managed planner graph artifact.",
      inputSchema: {
        path: z.string().min(1),
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
      description: "Overwrite a Markdown planning doc with new content and optional metadata.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string(),
        metadata: metadataInputSchema.optional(),
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
      description: "Overwrite a graph artifact with new graph data.",
      inputSchema: {
        path: z.string().min(1),
        graph: graphInputSchema,
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
      description: "Rename or move a doc, graph, or folder within the planning workspace.",
      inputSchema: {
        path: z.string().min(1),
        newPath: z.string().min(1),
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
      description: "Archive a planning entry by moving it under .project-docs/.archive.",
      inputSchema: {
        path: z.string().min(1),
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
      description: "Restore an archived planning entry back into the active workspace.",
      inputSchema: {
        path: z.string().min(1),
        restorePath: z.string().optional(),
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
        "Compile docs and graph artifacts into a machine-friendly bundle plus a readable summary for agent consumption.",
      inputSchema: {
        entryPaths: z.array(z.string()).optional(),
      },
    },
    async ({ entryPaths }) => {
      const result = await withWorkspace(() => compileContext(workspaceRoot, { entryPaths }));
      return serializeResult(result);
    },
  );

  return server;
}

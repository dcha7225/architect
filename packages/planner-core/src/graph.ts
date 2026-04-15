import { plannerGraphSchema } from "./schemas.js";
import { deriveSummary, normalizeMetadata } from "./metadata.js";
import type { PlannerGraph, PlannerGraphEntry } from "./types.js";

function buildRevision(mtimeMs: number, size: number): string {
  return `${Math.floor(mtimeMs)}-${size}`;
}

function defaultTitle(path: string): string {
  return path.split("/").pop()?.replace(/\.planner-graph\.json$/, "") ?? "Untitled Graph";
}

export function createEmptyGraph(title = "Untitled Graph"): PlannerGraph {
  return {
    version: 1,
    metadata: {
      title,
      updatedAt: new Date().toISOString(),
    },
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    nodes: [],
    edges: [],
    groups: [],
    comments: [],
  };
}

export function parseGraphDocument(
  raw: string,
  options: {
    path: string;
    archived: boolean;
    mtimeMs: number;
    size: number;
  },
): PlannerGraphEntry {
  const parsed = plannerGraphSchema.parse(JSON.parse(raw));
  const fallbackTitle = defaultTitle(options.path);
  const fallbackSummary = deriveSummary(
    [
      parsed.metadata.summary,
      parsed.nodes.map((node) => `${node.label}${node.body ? `: ${node.body}` : ""}`).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
    "Graph design artifact",
  );
  const metadata = normalizeMetadata(parsed.metadata, {
    fallbackTitle,
    fallbackSummary,
  });

  return {
    kind: "graph",
    name: options.path.split("/").pop() ?? options.path,
    path: options.path,
    archived: options.archived,
    metadata,
    title: metadata.title ?? fallbackTitle,
    summary: metadata.summary ?? fallbackSummary,
    revision: buildRevision(options.mtimeMs, options.size),
    graph: {
      ...parsed,
      metadata,
    } as PlannerGraph,
  };
}

export function serializeGraphDocument(graph: PlannerGraph): string {
  const parsed = plannerGraphSchema.parse(graph);
  return JSON.stringify(parsed, null, 2);
}

import type {
  CompiledEntity,
  CompiledItem,
  CompiledRelationship,
  PlannerDocEntry,
  PlannerEntry,
  PlannerGraphEdge,
  PlannerGraphEntry,
  PlannerGraphGroup,
  PlannerGraphNode,
  ProjectContextResult,
} from "./types.js";

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function classifyText(...parts: Array<string | undefined>): string[] {
  const text = normalizeText(parts.filter(Boolean).join(" "));
  const classes = new Set<string>();

  if (!text) {
    return [];
  }

  if (/\b(requirement|shall|must|should|need to)\b/.test(text)) {
    classes.add("requirement");
  }
  if (/\b(constraint|limit|cannot|must not|boundary)\b/.test(text)) {
    classes.add("constraint");
  }
  if (/\b(decision|decide|chosen|tradeoff|rationale)\b/.test(text)) {
    classes.add("decision");
  }
  if (/\b(flow|workflow|pipeline|sequence|handoff)\b/.test(text)) {
    classes.add("flow");
  }
  if (/\b(question|unknown|unclear|todo)\b/.test(text) || /\?$/.test(text)) {
    classes.add("question");
  }
  if (
    /\b(component|service|module|screen|api|database|queue|agent|worker|system)\b/.test(text)
  ) {
    classes.add("component");
  }

  return Array.from(classes);
}

function extractDocItems(doc: PlannerDocEntry, kind: string): CompiledItem[] {
  const lines = doc.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .filter((line) => classifyText(line).includes(kind))
    .slice(0, 8)
    .map((line, index) => ({
      id: `${doc.path}:${kind}:${index}`,
      title: line.replace(/^[-*]\s*/, ""),
      source: {
        path: doc.path,
        kind: "doc",
        title: doc.title,
      },
    }));
}

function toEntityFromNode(graph: PlannerGraphEntry, node: PlannerGraphNode): CompiledEntity {
  const kind =
    (typeof node.annotations?.kind === "string" && node.annotations.kind) ||
    (typeof node.metadata?.kind === "string" && node.metadata.kind) ||
    classifyText(node.label, node.body)[0] ||
    "concept";

  return {
    id: `${graph.path}#node:${node.id}`,
    name: node.label,
    kind,
    description: node.body,
    tags: graph.metadata.tags,
    annotations: node.annotations,
    source: {
      path: graph.path,
      kind: "node",
      id: node.id,
      title: graph.title,
    },
  };
}

function toRelationshipFromEdge(
  graph: PlannerGraphEntry,
  edge: PlannerGraphEdge,
): CompiledRelationship {
  const kind =
    (typeof edge.annotations?.kind === "string" && edge.annotations.kind) ||
    classifyText(edge.label)[0] ||
    "connection";

  return {
    id: `${graph.path}#edge:${edge.id}`,
    sourceId: `${graph.path}#node:${edge.source}`,
    targetId: `${graph.path}#node:${edge.target}`,
    label: edge.label,
    kind,
    annotations: edge.annotations,
    source: {
      path: graph.path,
      kind: "edge",
      id: edge.id,
      title: graph.title,
    },
  };
}

function toItemFromGraph(
  graph: PlannerGraphEntry,
  item: PlannerGraphNode | PlannerGraphGroup,
  kind: string,
  index: number,
): CompiledItem {
  return {
    id: `${graph.path}:${kind}:${index}:${item.id}`,
    title: item.label,
    detail: "body" in item ? item.body : undefined,
    source: {
      path: graph.path,
      kind: "body" in item ? "node" : "group",
      id: item.id,
      title: graph.title,
    },
  };
}

export function compileProjectContext(entries: PlannerEntry[]): ProjectContextResult {
  const docs = entries.filter((entry): entry is PlannerDocEntry => entry.kind === "doc");
  const graphs = entries.filter((entry): entry is PlannerGraphEntry => entry.kind === "graph");
  const entities: CompiledEntity[] = [];
  const relationships: CompiledRelationship[] = [];
  const requirements: CompiledItem[] = [];
  const constraints: CompiledItem[] = [];
  const decisions: CompiledItem[] = [];
  const flows: CompiledItem[] = [];
  const openQuestions: CompiledItem[] = [];

  for (const doc of docs) {
    entities.push({
      id: `${doc.path}#doc`,
      name: doc.title,
      kind: classifyText(doc.title, doc.summary)[0] ?? "document",
      description: doc.summary,
      tags: doc.metadata.tags,
      source: {
        path: doc.path,
        kind: "doc",
        title: doc.title,
      },
    });
    requirements.push(...extractDocItems(doc, "requirement"));
    constraints.push(...extractDocItems(doc, "constraint"));
    decisions.push(...extractDocItems(doc, "decision"));
    flows.push(...extractDocItems(doc, "flow"));
    openQuestions.push(...extractDocItems(doc, "question"));
  }

  for (const graph of graphs) {
    entities.push(
      ...graph.graph.nodes.map((node) => toEntityFromNode(graph, node)),
      ...graph.graph.groups.map((group) => ({
        id: `${graph.path}#group:${group.id}`,
        name: group.label,
        kind:
          (typeof group.annotations?.kind === "string" && group.annotations.kind) ||
          classifyText(group.label)[0] ||
          "group",
        annotations: group.annotations,
        source: {
          path: graph.path,
          kind: "group" as const,
          id: group.id,
          title: graph.title,
        },
      })),
    );
    relationships.push(...graph.graph.edges.map((edge) => toRelationshipFromEdge(graph, edge)));

    graph.graph.nodes.forEach((node, index) => {
      const inferredKinds = new Set(
        [
          typeof node.annotations?.kind === "string" ? node.annotations.kind : undefined,
          ...classifyText(node.label, node.body),
        ].filter((value): value is string => Boolean(value)),
      );

      if (inferredKinds.has("requirement")) {
        requirements.push(toItemFromGraph(graph, node, "requirement", index));
      }
      if (inferredKinds.has("constraint")) {
        constraints.push(toItemFromGraph(graph, node, "constraint", index));
      }
      if (inferredKinds.has("decision")) {
        decisions.push(toItemFromGraph(graph, node, "decision", index));
      }
      if (inferredKinds.has("flow")) {
        flows.push(toItemFromGraph(graph, node, "flow", index));
      }
      if (inferredKinds.has("question")) {
        openQuestions.push(toItemFromGraph(graph, node, "question", index));
      }
    });
  }

  const bundle = {
    generatedAt: new Date().toISOString(),
    scopePaths: entries.map((entry) => entry.path),
    documents: docs.map((doc) => ({
      path: doc.path,
      title: doc.title,
      summary: doc.summary,
      tags: doc.metadata.tags ?? [],
      updatedAt: doc.metadata.updatedAt,
      content: doc.content,
    })),
    graphs: graphs.map((graph) => ({
      path: graph.path,
      title: graph.title,
      summary: graph.summary,
      tags: graph.metadata.tags ?? [],
      updatedAt: graph.metadata.updatedAt,
      nodes: graph.graph.nodes,
      edges: graph.graph.edges,
      groups: graph.graph.groups,
    })),
    entities,
    relationships,
    requirements,
    constraints,
    decisions,
    flows,
    openQuestions,
  };

  const summary = [
    "# Project Context",
    "",
    `Generated: ${bundle.generatedAt}`,
    "",
    "## Overview",
    "",
    `- Documents: ${bundle.documents.length}`,
    `- Graphs: ${bundle.graphs.length}`,
    `- Entities: ${bundle.entities.length}`,
    `- Relationships: ${bundle.relationships.length}`,
    "",
    "## Key Requirements",
    "",
    ...(requirements.length > 0
      ? requirements.slice(0, 8).map((item) => `- ${item.title} (${item.source.path})`)
      : ["- No explicit requirements extracted."]),
    "",
    "## Constraints",
    "",
    ...(constraints.length > 0
      ? constraints.slice(0, 8).map((item) => `- ${item.title} (${item.source.path})`)
      : ["- No explicit constraints extracted."]),
    "",
    "## Decisions",
    "",
    ...(decisions.length > 0
      ? decisions.slice(0, 8).map((item) => `- ${item.title} (${item.source.path})`)
      : ["- No explicit decisions extracted."]),
    "",
    "## Open Questions",
    "",
    ...(openQuestions.length > 0
      ? openQuestions.slice(0, 8).map((item) => `- ${item.title} (${item.source.path})`)
      : ["- No explicit open questions extracted."]),
  ].join("\n");

  return {
    bundle,
    summary,
  };
}

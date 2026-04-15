export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type EntryKind = "doc" | "graph" | "folder";

export interface PlannerMetadata extends JsonObject {
  title?: string;
  tags?: string[];
  summary?: string;
  updatedAt?: string;
}

export interface PlannerEntryBase {
  kind: EntryKind;
  name: string;
  path: string;
  archived: boolean;
}

export interface PlannerFolderEntry extends PlannerEntryBase {
  kind: "folder";
  children?: PlannerEntrySummary[];
}

export interface PlannerDocEntry extends PlannerEntryBase {
  kind: "doc";
  metadata: PlannerMetadata;
  title: string;
  summary: string;
  revision: string;
  content: string;
}

export interface PlannerGraphNode {
  id: string;
  label: string;
  position: {
    x: number;
    y: number;
  };
  body?: string;
  color?: string;
  metadata?: JsonObject;
  annotations?: JsonObject;
  links?: string[];
}

export interface PlannerGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  color?: string;
  metadata?: JsonObject;
  annotations?: JsonObject;
}

export interface PlannerGraph {
  version: number;
  metadata: PlannerMetadata;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: PlannerGraphNode[];
  edges: PlannerGraphEdge[];
}

export interface PlannerGraphEntry extends PlannerEntryBase {
  kind: "graph";
  metadata: PlannerMetadata;
  title: string;
  summary: string;
  revision: string;
  graph: PlannerGraph;
}

export type PlannerEntry = PlannerDocEntry | PlannerGraphEntry | PlannerFolderEntry;

export interface PlannerEntrySummary extends PlannerEntryBase {
  title?: string;
  summary?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface CompileReference {
  path: string;
  kind: "doc" | "graph" | "node" | "edge";
  id?: string;
  title?: string;
}

export interface CompiledEntity {
  id: string;
  name: string;
  kind: string;
  description?: string;
  tags?: string[];
  annotations?: JsonObject;
  source: CompileReference;
}

export interface CompiledRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  kind: string;
  annotations?: JsonObject;
  source: CompileReference;
}

export interface CompiledItem {
  id: string;
  title: string;
  detail?: string;
  source: CompileReference;
}

export interface ProjectContextBundle {
  generatedAt: string;
  scopePaths: string[];
  documents: Array<{
    path: string;
    title: string;
    summary: string;
    tags: string[];
    updatedAt?: string;
    content: string;
  }>;
  graphs: Array<{
    path: string;
    title: string;
    summary: string;
    tags: string[];
    updatedAt?: string;
    nodes: PlannerGraphNode[];
    edges: PlannerGraphEdge[];
  }>;
  entities: CompiledEntity[];
  relationships: CompiledRelationship[];
  requirements: CompiledItem[];
  constraints: CompiledItem[];
  decisions: CompiledItem[];
  flows: CompiledItem[];
  openQuestions: CompiledItem[];
}

export interface ProjectContextResult {
  bundle: ProjectContextBundle;
  summary: string;
}

export interface ListEntriesOptions {
  includeArchived?: boolean;
}

export interface CompileContextOptions {
  entryPaths?: string[];
}

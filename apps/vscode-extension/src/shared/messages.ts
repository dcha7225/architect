import type {
  PlannerEntry,
  PlannerEntrySummary,
  PlannerGraph,
  ProjectContextResult,
} from "@project-design-planner/planner-core";

export type PlannerRequestMethod =
  | "initialize"
  | "getEntry"
  | "createFolder"
  | "createDoc"
  | "createGraph"
  | "updateDoc"
  | "updateGraph"
  | "moveEntry"
  | "duplicateEntry"
  | "archiveEntry"
  | "restoreEntry"
  | "compileContext"
  | "revealInExplorer";

export interface PlannerRequestPayloadMap {
  initialize: Record<string, never>;
  getEntry: {
    path: string;
    includeArchived?: boolean;
  };
  createFolder: {
    path: string;
  };
  createDoc: {
    path: string;
    content?: string;
    metadata?: Record<string, unknown>;
  };
  createGraph: {
    path: string;
    graph?: PlannerGraph;
  };
  updateDoc: {
    path: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  updateGraph: {
    path: string;
    graph: PlannerGraph;
  };
  moveEntry: {
    path: string;
    newPath: string;
  };
  duplicateEntry: {
    path: string;
    newPath?: string;
  };
  archiveEntry: {
    path: string;
  };
  restoreEntry: {
    path: string;
    restorePath?: string;
  };
  compileContext: {
    entryPaths?: string[];
  };
  revealInExplorer: {
    path: string;
  };
}

export interface PlannerResponsePayloadMap {
  initialize: {
    workspaceName: string;
    entries: PlannerEntrySummary[];
  };
  getEntry: {
    entry: PlannerEntry;
  };
  createFolder: {
    path: string;
  };
  createDoc: {
    entry: PlannerEntry;
  };
  createGraph: {
    entry: PlannerEntry;
  };
  updateDoc: {
    entry: PlannerEntry;
  };
  updateGraph: {
    entry: PlannerEntry;
  };
  moveEntry: {
    entry: PlannerEntry;
  };
  duplicateEntry: {
    entry: PlannerEntry;
  };
  archiveEntry: {
    entry: PlannerEntry;
  };
  restoreEntry: {
    entry: PlannerEntry;
  };
  compileContext: ProjectContextResult;
  revealInExplorer: {
    revealed: string;
  };
}

export interface PlannerRequestMessage<
  TMethod extends PlannerRequestMethod = PlannerRequestMethod,
> {
  type: "request";
  id: string;
  method: TMethod;
  payload: PlannerRequestPayloadMap[TMethod];
}

export type PlannerClientMessage = PlannerRequestMessage;

export type PlannerResponseMessage<
  TMethod extends PlannerRequestMethod = PlannerRequestMethod,
> =
  | {
      type: "response";
      id: string;
      ok: true;
      result: PlannerResponsePayloadMap[TMethod];
    }
  | {
      type: "response";
      id: string;
      ok: false;
      error: string;
    };

export interface PlannerEntriesChangedEvent {
  type: "event";
  event: "entriesChanged";
  payload: {
    entries: PlannerEntrySummary[];
    changedPath?: string;
  };
}

export type PlannerServerEventMessage = PlannerEntriesChangedEvent;

import Editor from "@monaco-editor/react";
import type {
  JsonObject,
  PlannerDocEntry,
  PlannerEntry,
  PlannerEntrySummary,
  PlannerGraph,
  PlannerGraphEdge,
  PlannerGraphEntry,
  PlannerGraphNode,
  PlannerMetadata,
  ProjectContextResult,
} from "@project-design-planner/planner-core";
import { marked } from "marked";
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import ReactFlow, {
  Handle,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  Position,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type OnConnect,
  type ReactFlowInstance,
} from "reactflow";

import type { PlannerServerEventMessage } from "@shared/messages";

import { configureMonaco } from "./monaco";
import { callPlanner, loadWebviewState, onPlannerEvent, saveWebviewState } from "./vscode";

import "reactflow/dist/style.css";

configureMonaco();

type EntryTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "doc" | "graph";
  archived: boolean;
  title?: string;
  summary?: string;
  updatedAt?: string;
  children: EntryTreeNode[];
};

type MetadataDraft = {
  title: string;
  tagsText: string;
  summary: string;
  extraText: string;
};

type GraphSelection =
  | {
      kind: "node" | "edge";
      id: string;
    }
  | null;

type CanvasNodeData = {
  title: string;
  body?: string;
  color?: string;
};

type CanvasNode = Node<CanvasNodeData>;
type GraphPaletteKind = "node";

type DocTabState = {
  kind: "doc";
  path: string;
  archived: boolean;
  revision: string;
  dirty: boolean;
  stale: boolean;
  preview: boolean;
  content: string;
  metadataDraft: MetadataDraft;
};

type GraphTabState = {
  kind: "graph";
  path: string;
  archived: boolean;
  revision: string;
  dirty: boolean;
  stale: boolean;
  graph: PlannerGraph;
  metadataDraft: MetadataDraft;
  selection: GraphSelection;
};

type TabState = DocTabState | GraphTabState;

type PersistedUiState = {
  activePath?: string;
  selectedPath?: string;
  showArchived?: boolean;
};

type ActionDialogState =
  | {
      kind: "text";
      title: string;
      message: string;
      label: string;
      confirmLabel: string;
      value: string;
      danger?: boolean;
      onConfirm: (value: string) => Promise<void>;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => Promise<void>;
    };

const MANAGED_METADATA_KEYS = new Set(["title", "tags", "summary", "updatedAt"]);

function splitTags(tagsText: string): string[] {
  return Array.from(
    new Set(
      tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function createMetadataDraft(metadata: PlannerMetadata): MetadataDraft {
  const extraMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !MANAGED_METADATA_KEYS.has(key)),
  );

  return {
    title: metadata.title ?? "",
    tagsText: (metadata.tags ?? []).join(", "),
    summary: metadata.summary ?? "",
    extraText: Object.keys(extraMetadata).length > 0 ? JSON.stringify(extraMetadata, null, 2) : "",
  };
}

function parseMetadataDraft(draft: MetadataDraft): { metadata?: Record<string, unknown>; error?: string } {
  let extraMetadata: Record<string, unknown> = {};
  if (draft.extraText.trim()) {
    try {
      const parsed = JSON.parse(draft.extraText);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return { error: "Extra metadata must be a JSON object." };
      }
      extraMetadata = parsed as Record<string, unknown>;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to parse extra metadata.",
      };
    }
  }

  return {
    metadata: {
      ...extraMetadata,
      title: draft.title,
      tags: splitTags(draft.tagsText),
      summary: draft.summary,
    },
  };
}

function isSameSelection(left: GraphSelection, right: GraphSelection): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.kind === right.kind && left.id === right.id;
}

function normalizeGraph(graph: PlannerGraph): PlannerGraph {
  return {
    ...graph,
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
    viewport: graph.viewport ?? {
      x: 0,
      y: 0,
      zoom: 1,
    },
  };
}

function createTabState(entry: PlannerEntry): TabState {
  if (entry.kind === "doc") {
    return {
      kind: "doc",
      path: entry.path,
      archived: entry.archived,
      revision: entry.revision,
      dirty: false,
      stale: false,
      preview: false,
      content: entry.content,
      metadataDraft: createMetadataDraft(entry.metadata),
    };
  }

  if (entry.kind === "graph") {
    return {
      kind: "graph",
      path: entry.path,
      archived: entry.archived,
      revision: entry.revision,
      dirty: false,
      stale: false,
      graph: normalizeGraph(entry.graph),
      metadataDraft: createMetadataDraft(entry.metadata),
      selection: null,
    };
  }

  throw new Error("Folders cannot be opened as tabs.");
}

function getTabTitle(tab: TabState): string {
  return tab.metadataDraft.title || tab.path.split("/").pop() || tab.path;
}

function getPathLabel(entryPath: string): string {
  return entryPath.split("/").pop() || entryPath;
}

function humanizeEntryName(entryPath: string): string {
  const label = getPathLabel(entryPath)
    .replace(/\.planner-graph\.json$/i, "")
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!label) {
    return "Untitled";
  }

  return label
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildTree(entries: PlannerEntrySummary[], showArchived: boolean, search: string): EntryTreeNode[] {
  const normalizedSearch = search.trim().toLowerCase();
  const root: EntryTreeNode = {
    id: "__root__",
    name: "root",
    path: "",
    kind: "folder",
    archived: false,
    children: [],
  };
  const folders = new Map<string, EntryTreeNode>([["", root]]);

  for (const entry of entries) {
    if (!showArchived && entry.archived) {
      continue;
    }

    if (
      normalizedSearch &&
      !entry.path.toLowerCase().includes(normalizedSearch) &&
      !entry.title?.toLowerCase().includes(normalizedSearch) &&
      !entry.summary?.toLowerCase().includes(normalizedSearch)
    ) {
      continue;
    }

    const segments = entry.path.split("/");
    let currentPath = "";

    segments.forEach((segment, index) => {
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      if (isLeaf && entry.kind !== "folder") {
        const parent = folders.get(currentPath) ?? root;
        parent.children.push({
          id: nextPath,
          name: segment,
          path: entry.path,
          kind: entry.kind,
          archived: entry.archived,
          title: entry.title,
          summary: entry.summary,
          updatedAt: entry.updatedAt,
          children: [],
        });
      } else {
        if (!folders.has(nextPath)) {
          const parent = folders.get(currentPath) ?? root;
          const folderNode: EntryTreeNode = {
            id: nextPath,
            name: segment,
            path: nextPath,
            kind: "folder",
            archived: entry.archived || nextPath.startsWith(".archive"),
            children: [],
          };
          folders.set(nextPath, folderNode);
          parent.children.push(folderNode);
        }
      }

      currentPath = nextPath;
    });
  }

  const sortTree = (nodes: EntryTreeNode[]): EntryTreeNode[] =>
    nodes
      .sort((left, right) => {
        if (left.kind === "folder" && right.kind !== "folder") {
          return -1;
        }
        if (left.kind !== "folder" && right.kind === "folder") {
          return 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((node) => ({
        ...node,
        children: sortTree(node.children),
      }));

  return sortTree(root.children);
}

function pathDirectory(entryPath: string | undefined): string {
  if (!entryPath) {
    return "";
  }

  const segments = entryPath.split("/");
  segments.pop();
  return segments.join("/");
}

function pathJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function stripArchivePrefix(entryPath: string): string {
  return entryPath.startsWith(".archive/") ? entryPath.slice(".archive/".length) : entryPath;
}

function estimateCanvasNodeSize(node: PlannerGraphNode): { width: number; height: number } {
  return {
    width: 220,
    height: node.body?.trim() ? 126 : 86,
  };
}

function makeReactNodes(graph: PlannerGraph): CanvasNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "plannerNode",
    position: node.position,
    data: {
      title: node.label,
      body: node.body,
      color: node.color,
    },
    style: {
      width: estimateCanvasNodeSize(node).width,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    zIndex: 10,
  }));
}

function makeReactEdges(graph: PlannerGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    style: {
      stroke: edge.color || "var(--accent)",
      strokeWidth: 2,
    },
  }));
}

function graphFromReactState(
  graph: PlannerGraph,
  nextNodes: CanvasNode[],
  nextEdges: Edge[],
): PlannerGraph {
  return {
    ...graph,
    nodes: nextNodes.map((node) => {
      const existing = graph.nodes.find((candidate) => candidate.id === node.id);
      return {
        id: node.id,
        label: existing?.label ?? node.data.title ?? "Node",
        body: existing?.body,
        color: existing?.color,
        metadata: existing?.metadata,
        annotations: existing?.annotations,
        links: existing?.links,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
      };
    }),
    edges: nextEdges.map((edge) => {
      const existing = graph.edges.find((candidate) => candidate.id === edge.id);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === "string" ? edge.label : existing?.label,
        color: existing?.color,
        metadata: existing?.metadata,
        annotations: existing?.annotations,
      };
    }),
  };
}

function PlannerGraphNodeCard({ data, selected }: NodeProps<CanvasNodeData>) {
  return (
    <div
      className={`graph-node-card ${selected ? "selected" : ""}`}
      style={{ borderColor: data.color || "var(--border-strong)" }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="graph-node-card__title">{data.title}</div>
      {data.body ? <div className="graph-node-card__body">{data.body}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const graphNodeTypes: NodeTypes = {
  plannerNode: PlannerGraphNodeCard,
};

type PaneErrorBoundaryProps = {
  entryKey: string;
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
};

type PaneErrorBoundaryState = {
  error: Error | null;
};

class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): PaneErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Planner pane crashed", error, errorInfo);
  }

  componentDidUpdate(prevProps: PaneErrorBoundaryProps): void {
    if (prevProps.entryKey !== this.props.entryKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return this.props.children;
  }
}

function nodeSelectionFromCanvasNode(node: CanvasNode | undefined): GraphSelection {
  if (!node) {
    return null;
  }

  return {
    kind: "node",
    id: node.id,
  };
}

function PlannerApp() {
  const persistedState = loadWebviewState<PersistedUiState>();
  const recentWritePaths = useRef<Record<string, number>>({});
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [entries, setEntries] = useState<PlannerEntrySummary[]>([]);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>(persistedState?.activePath);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(persistedState?.selectedPath);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([".archive"]));
  const [showArchived, setShowArchived] = useState(persistedState?.showArchived ?? false);
  const [search, setSearch] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>("Loading planner...");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [compileResult, setCompileResult] = useState<{
    label: string;
    result: ProjectContextResult;
  } | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [actionDialogBusy, setActionDialogBusy] = useState(false);
  const [actionDialogError, setActionDialogError] = useState<string>();

  useEffect(() => {
    saveWebviewState({
      activePath,
      selectedPath,
      showArchived,
    } satisfies PersistedUiState);
  }, [activePath, selectedPath, showArchived]);

  useEffect(() => {
    const dispose = onPlannerEvent((message: PlannerServerEventMessage) => {
      if (message.event === "entriesChanged") {
        setEntries(message.payload.entries);
        if (message.payload.changedPath) {
          const changedPath = message.payload.changedPath;
          const lastWrite = recentWritePaths.current[changedPath];
          if (!lastWrite || Date.now() - lastWrite > 1500) {
            setTabs((currentTabs) =>
              currentTabs.map((tab) =>
                tab.path === changedPath
                  ? {
                      ...tab,
                      stale: true,
                    }
                  : tab,
              ),
            );
            setStatusMessage(`Updated on disk: ${changedPath}`);
          }
        }
      }
    });

    void (async () => {
      try {
        const initial = await callPlanner("initialize", {});
        setWorkspaceName(initial.workspaceName);
        setEntries(initial.entries);
        setStatusMessage("Planner ready.");

        const persistedActivePath =
          persistedState?.activePath &&
          initial.entries.some(
            (entry) => entry.path === persistedState.activePath && entry.kind !== "folder",
          )
            ? persistedState.activePath
            : undefined;
        const initialPath =
          persistedActivePath ||
          initial.entries.find((entry) => entry.kind === "doc" && entry.path === "README.md")?.path ||
          initial.entries.find((entry) => entry.kind !== "folder" && !entry.archived)?.path;

        if (initialPath) {
          await openEntry(initialPath);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize the planner.");
      }
    })();

    return dispose;
  }, []);

  const tree = buildTree(entries, showArchived, search);
  const activeTab = tabs.find((tab) => tab.path === activePath);
  const selectedEntryPath = selectedPath ?? activeTab?.path;

  async function openEntry(entryPath: string): Promise<void> {
    setSelectedPath(entryPath);
    setErrorMessage(undefined);
    try {
      const result = await callPlanner("getEntry", {
        path: entryPath,
        includeArchived: true,
      });
      if (result.entry.kind === "folder") {
        setActivePath(undefined);
        return;
      }

      const nextTab = createTabState(result.entry);
      setTabs((currentTabs) => {
        const existingIndex = currentTabs.findIndex((tab) => tab.path === entryPath);
        if (existingIndex >= 0) {
          const updatedTabs = [...currentTabs];
          updatedTabs[existingIndex] = nextTab;
          return updatedTabs;
        }
        return [...currentTabs, nextTab];
      });
      setActivePath(entryPath);
      setStatusMessage(`Opened ${entryPath}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Failed to open ${entryPath}`);
    }
  }

  function updateTab(entryPath: string, updater: (tab: TabState) => TabState): void {
    setTabs((currentTabs) => {
      let changed = false;
      const nextTabs = currentTabs.map((tab) => {
        if (tab.path !== entryPath) {
          return tab;
        }

        const nextTab = updater(tab);
        if (nextTab !== tab) {
          changed = true;
        }
        return nextTab;
      });

      return changed ? nextTabs : currentTabs;
    });
  }

  function replaceTab(entry: PlannerEntry): void {
    const nextTab = createTabState(entry);
    setTabs((currentTabs) => {
      const existingIndex = currentTabs.findIndex((tab) => tab.path === entry.path);
      if (existingIndex >= 0) {
        const updatedTabs = [...currentTabs];
        updatedTabs[existingIndex] = nextTab;
        return updatedTabs;
      }
      return [...currentTabs, nextTab];
    });
    setActivePath(entry.path);
    setSelectedPath(entry.path);
  }

  function closeTab(entryPath: string): void {
    setTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.path !== entryPath);
      if (activePath === entryPath) {
        setActivePath(nextTabs.at(-1)?.path);
      }
      return nextTabs;
    });
  }

  function updateMetadataDraft(entryPath: string, partial: Partial<MetadataDraft>): void {
    updateTab(entryPath, (tab) => ({
      ...tab,
      dirty: true,
      metadataDraft: {
        ...tab.metadataDraft,
        ...partial,
      },
    }));
  }

  async function saveTab(tab: TabState): Promise<void> {
    const { metadata, error } = parseMetadataDraft(tab.metadataDraft);
    if (error || !metadata) {
      setErrorMessage(error);
      return;
    }

    try {
      recentWritePaths.current[tab.path] = Date.now();
      if (tab.kind === "doc") {
        const result = await callPlanner("updateDoc", {
          path: tab.path,
          content: tab.content,
          metadata,
        });
        replaceTab(result.entry);
      } else {
        const result = await callPlanner("updateGraph", {
          path: tab.path,
          graph: {
            ...tab.graph,
            metadata: metadata as PlannerMetadata,
          },
        });
        replaceTab(result.entry);
      }
      setStatusMessage(`Saved ${tab.path}`);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Failed to save ${tab.path}`);
    }
  }

  async function revertTab(tab: TabState): Promise<void> {
    await openEntry(tab.path);
    setStatusMessage(`Reloaded ${tab.path}`);
  }

  function openActionDialog(dialog: ActionDialogState): void {
    setActionDialog(dialog);
    setActionDialogError(undefined);
  }

  function closeActionDialog(): void {
    if (actionDialogBusy) {
      return;
    }
    setActionDialog(null);
    setActionDialogError(undefined);
  }

  async function submitActionDialog(): Promise<void> {
    if (!actionDialog) {
      return;
    }

    const submittedValue =
      actionDialog.kind === "text" ? actionDialog.value.trim() : undefined;

    if (actionDialog.kind === "text" && !submittedValue) {
      setActionDialogError("A path is required.");
      return;
    }

    setActionDialogBusy(true);
    setActionDialogError(undefined);

    try {
      if (actionDialog.kind === "text") {
        await actionDialog.onConfirm(submittedValue ?? "");
      } else {
        await actionDialog.onConfirm();
      }
      setActionDialog(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Planner action failed.";
      setActionDialogError(message);
      setErrorMessage(message);
    } finally {
      setActionDialogBusy(false);
    }
  }

  async function createEntryAtPath(
    kind: "doc" | "graph" | "folder",
    requestedPath: string,
  ): Promise<void> {
    setErrorMessage(undefined);

    if (kind === "folder") {
      await callPlanner("createFolder", { path: requestedPath });
      setSelectedPath(requestedPath);
      setExpandedFolders((current) => new Set(current).add(requestedPath));
      setStatusMessage(`Created folder ${requestedPath}`);
      return;
    }

    if (kind === "doc") {
      const starterTitle = humanizeEntryName(requestedPath);
      const result = await callPlanner("createDoc", {
        path: requestedPath,
        content: `# ${starterTitle}\n\nCapture the key planning details here.\n`,
      });
      replaceTab(result.entry);
      setStatusMessage(`Created ${result.entry.path}`);
      return;
    }

    const result = await callPlanner("createGraph", {
      path: requestedPath,
    });
    replaceTab(result.entry);
    setStatusMessage(`Created ${result.entry.path}`);
  }

  async function createEntry(kind: "doc" | "graph" | "folder"): Promise<void> {
    const baseDirectory =
      selectedEntryPath && entries.find((entry) => entry.path === selectedEntryPath)?.kind === "folder"
        ? selectedEntryPath
        : pathDirectory(selectedEntryPath);
    const defaultName =
      kind === "doc" ? "new-note" : kind === "graph" ? "new-design" : "new-folder";
    const promptValue = pathJoin(baseDirectory, defaultName);
    openActionDialog({
      kind: "text",
      title: `Create ${kind === "doc" ? "Document" : kind === "graph" ? "Graph" : "Folder"}`,
      message: "Choose where the new planner entry should be created inside .project-docs.",
      label: "Entry Path",
      confirmLabel: `Create ${kind === "doc" ? "Doc" : kind === "graph" ? "Graph" : "Folder"}`,
      value: promptValue,
      onConfirm: async (requestedPath) => {
        await createEntryAtPath(kind, requestedPath);
      },
    });
  }

  async function moveEntryToPath(entryPath: string, newPath: string): Promise<void> {
    const result = await callPlanner("moveEntry", {
      path: entryPath,
      newPath,
    });
    if (result.entry.kind !== "folder") {
      setTabs((currentTabs) => currentTabs.filter((tab) => tab.path !== entryPath));
      replaceTab(result.entry);
    } else {
      setSelectedPath(result.entry.path);
    }
    setStatusMessage(`Moved to ${result.entry.path}`);
  }

  async function moveSelected(): Promise<void> {
    if (!selectedEntryPath) {
      return;
    }

    openActionDialog({
      kind: "text",
      title: "Rename or Move Entry",
      message: `Update the path for ${selectedEntryPath}.`,
      label: "New Path",
      confirmLabel: "Move Entry",
      value: selectedEntryPath,
      onConfirm: async (newPath) => {
        if (newPath === selectedEntryPath) {
          return;
        }
        await moveEntryToPath(selectedEntryPath, newPath);
      },
    });
  }

  async function duplicateEntryToPath(entryPath: string, newPath: string): Promise<void> {
    const result = await callPlanner("duplicateEntry", {
      path: entryPath,
      newPath,
    });
    if (result.entry.kind !== "folder") {
      replaceTab(result.entry);
    }
    setStatusMessage(`Duplicated to ${result.entry.path}`);
  }

  async function duplicateSelected(): Promise<void> {
    if (!selectedEntryPath) {
      return;
    }

    openActionDialog({
      kind: "text",
      title: "Duplicate Entry",
      message: `Choose the destination path for a copy of ${selectedEntryPath}.`,
      label: "Duplicate Path",
      confirmLabel: "Duplicate Entry",
      value: `${selectedEntryPath}-copy`,
      onConfirm: async (newPath) => {
        await duplicateEntryToPath(selectedEntryPath, newPath);
      },
    });
  }

  async function archiveSelected(): Promise<void> {
    if (!selectedEntryPath) {
      return;
    }

    openActionDialog({
      kind: "confirm",
      title: "Archive Entry",
      message: `Archive ${selectedEntryPath}? You can restore it later from the archive.`,
      confirmLabel: "Archive Entry",
      danger: true,
      onConfirm: async () => {
        const result = await callPlanner("archiveEntry", {
          path: selectedEntryPath,
        });
        if (result.entry.kind !== "folder") {
          setTabs((currentTabs) => currentTabs.filter((tab) => tab.path !== selectedEntryPath));
          replaceTab(result.entry);
        }
        setStatusMessage(`Archived ${selectedEntryPath}`);
      },
    });
  }

  async function restoreSelected(): Promise<void> {
    if (!selectedEntryPath) {
      return;
    }

    openActionDialog({
      kind: "text",
      title: "Restore Archived Entry",
      message: `Choose where to restore ${selectedEntryPath}.`,
      label: "Restore Path",
      confirmLabel: "Restore Entry",
      value: stripArchivePrefix(selectedEntryPath),
      onConfirm: async (restorePath) => {
        const result = await callPlanner("restoreEntry", {
          path: selectedEntryPath,
          restorePath,
        });
        if (result.entry.kind !== "folder") {
          setTabs((currentTabs) => currentTabs.filter((tab) => tab.path !== selectedEntryPath));
          replaceTab(result.entry);
        }
        setStatusMessage(`Restored to ${result.entry.path}`);
      },
    });
  }

  async function compile(scope: "workspace" | "selected"): Promise<void> {
    try {
      const entryPaths = scope === "selected" && selectedEntryPath ? [selectedEntryPath] : undefined;
      const result = await callPlanner("compileContext", { entryPaths });
      setCompileResult({
        label: scope === "selected" && selectedEntryPath ? selectedEntryPath : "Entire workspace",
        result,
      });
      setStatusMessage(`Compiled context for ${scope === "selected" ? "selection" : "workspace"}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to compile context.");
    }
  }

  async function revealSelected(): Promise<void> {
    if (!selectedEntryPath) {
      return;
    }

    try {
      await callPlanner("revealInExplorer", { path: selectedEntryPath });
      setStatusMessage(`Revealed ${selectedEntryPath}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to reveal entry.");
    }
  }

  const treeNodes = useMemo(() => tree, [tree]);

  return (
    <div className="planner-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Project Design Planner</div>
          <h1>{workspaceName}</h1>
        </div>
        <div className="toolbar">
          <button onClick={() => createEntry("doc")}>New Doc</button>
          <button onClick={() => createEntry("graph")}>New Graph</button>
          <button onClick={() => createEntry("folder")}>New Folder</button>
          <button onClick={moveSelected} disabled={!selectedEntryPath}>
            Rename / Move
          </button>
          <button onClick={duplicateSelected} disabled={!selectedEntryPath}>
            Duplicate
          </button>
          <button onClick={() => compile("selected")} disabled={!selectedEntryPath}>
            Compile Selected
          </button>
          <button onClick={() => compile("workspace")}>Compile Workspace</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar">
          <div className="sidebar-controls">
            <input
              placeholder="Search docs and graphs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label className="checkbox">
              <input
                checked={showArchived}
                type="checkbox"
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archive
            </label>
          </div>

          <nav className="tree">
            {treeNodes.length === 0 ? (
              <div className="empty-state">No planner entries yet.</div>
            ) : (
              treeNodes.map((node) => (
                <TreeNodeRow
                  key={node.id}
                  node={node}
                  selectedPath={selectedPath}
                  expandedFolders={expandedFolders}
                  setExpandedFolders={setExpandedFolders}
                  onSelect={(path, kind) => {
                    setSelectedPath(path);
                    if (kind !== "folder") {
                      void openEntry(path);
                    }
                  }}
                />
              ))
            )}
          </nav>
        </aside>

        <main className="main-pane">
          <div className="tab-strip">
            {tabs.map((tab) => (
              <button
                key={tab.path}
                className={`tab ${tab.path === activePath ? "active" : ""} ${tab.archived ? "archived" : ""}`}
                onClick={() => {
                  setActivePath(tab.path);
                  setSelectedPath(tab.path);
                }}
              >
                <span>{getPathLabel(tab.path)}</span>
                {tab.dirty ? <span className="tab-pill">Unsaved</span> : null}
                {tab.stale ? <span className="tab-pill warning">Disk Updated</span> : null}
                <span
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.path);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>

          {activeTab ? (
            <div className="editor-frame">
              <div className="editor-header">
                <div>
                  <div className={`editor-title ${activeTab.archived ? "archived" : ""}`}>
                    {getTabTitle(activeTab)}
                  </div>
                  <div className="editor-meta">{activeTab.path}</div>
                  {activeTab.archived ? <div className="entry-status archived">Archived entry</div> : null}
                </div>
                <div className="editor-actions">
                  {activeTab.archived ? <button onClick={() => void restoreSelected()}>Restore</button> : null}
                  <button onClick={() => void revertTab(activeTab)}>Revert</button>
                  <button className="primary" onClick={() => void saveTab(activeTab)}>
                    Save
                  </button>
                </div>
              </div>

              {activeTab.stale ? (
                <div className="banner warning">
                  A newer version exists on disk. Reload to sync or keep editing and overwrite on save.
                  <button onClick={() => void revertTab(activeTab)}>Reload from Disk</button>
                </div>
              ) : null}

              <PaneErrorBoundary
                entryKey={`${activeTab.kind}:${activeTab.path}:${activeTab.revision}`}
                fallback={(error, reset) =>
                  activeTab.kind === "graph" ? (
                    <GraphFallbackPane
                      tab={activeTab}
                      error={error}
                      onRetryCanvas={reset}
                      onApplyGraph={(graph) =>
                        updateTab(activeTab.path, (tab) =>
                          tab.kind === "graph"
                            ? {
                                ...tab,
                                graph,
                                dirty: true,
                              }
                            : tab,
                        )
                      }
                    />
                  ) : (
                    <div className="banner error">
                      <div>
                        This editor pane crashed while rendering.
                        <div className="error-detail">{error.message || "Unknown editor error."}</div>
                      </div>
                      <button onClick={reset}>Retry</button>
                    </div>
                  )
                }
              >
                {activeTab.kind === "doc" ? (
                  <DocEditorPane
                    tab={activeTab}
                    onTogglePreview={() =>
                      updateTab(activeTab.path, (tab) =>
                        tab.kind === "doc"
                          ? {
                              ...tab,
                              preview: !tab.preview,
                            }
                          : tab,
                      )
                    }
                    onContentChange={(content) =>
                      updateTab(activeTab.path, (tab) =>
                        tab.kind === "doc"
                          ? {
                              ...tab,
                              content,
                              dirty: true,
                            }
                          : tab,
                      )
                    }
                  />
                ) : (
                  <GraphEditorPane
                    tab={activeTab}
                    onChange={(graph) =>
                      updateTab(activeTab.path, (tab) =>
                        tab.kind === "graph"
                          ? {
                              ...tab,
                              graph,
                              dirty: true,
                            }
                          : tab,
                      )
                    }
                    onSelectionChange={(selection) =>
                      updateTab(activeTab.path, (tab) =>
                        tab.kind === "graph"
                          ? isSameSelection(tab.selection, selection)
                            ? tab
                            : {
                                ...tab,
                                selection,
                              }
                          : tab,
                      )
                    }
                  />
                )}
              </PaneErrorBoundary>
            </div>
          ) : (
            <div className="empty-state large">
              Select a document or graph from the workspace tree to start editing.
            </div>
          )}
        </main>

        <aside className="inspector">
          {activeTab ? (
            <InspectorPane
              tab={activeTab}
              onMetadataChange={(partial) => updateMetadataDraft(activeTab.path, partial)}
              onTabChange={(nextTab) =>
                updateTab(activeTab.path, () => ({
                  ...nextTab,
                  dirty: true,
                }))
              }
              onReveal={revealSelected}
              onCopyPath={() => {
                if (selectedEntryPath) {
                  void navigator.clipboard.writeText(selectedEntryPath);
                  setStatusMessage(`Copied path ${selectedEntryPath}`);
                }
              }}
            />
          ) : (
            <div className="empty-state">Open a planner entry to inspect its metadata.</div>
          )}

          <div className="status-panel">
            <h3>Status</h3>
            <p>{statusMessage}</p>
            {errorMessage ? <div className="banner error">{errorMessage}</div> : null}
          </div>
        </aside>
      </div>

      {compileResult ? (
        <CompileModal
          label={compileResult.label}
          result={compileResult.result}
          onClose={() => setCompileResult(null)}
        />
      ) : null}
      {actionDialog ? (
        <ActionModal
          dialog={actionDialog}
          busy={actionDialogBusy}
          error={actionDialogError}
          onClose={closeActionDialog}
          onConfirm={() => void submitActionDialog()}
          onChange={(value) =>
            setActionDialog((current) =>
              current && current.kind === "text"
                ? {
                    ...current,
                    value,
                  }
                : current,
            )
          }
        />
      ) : null}
    </div>
  );
}

function TreeNodeRow(props: {
  node: EntryTreeNode;
  selectedPath?: string;
  expandedFolders: Set<string>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSelect: (path: string, kind: EntryTreeNode["kind"]) => void;
}) {
  const { node, selectedPath, expandedFolders, setExpandedFolders, onSelect } = props;
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <div className="tree-node">
      <button
        className={`tree-row ${isSelected ? "selected" : ""} ${node.archived ? "archived" : ""}`}
        onClick={() => {
          if (node.kind === "folder") {
            setExpandedFolders((current) => {
              const next = new Set(current);
              if (next.has(node.path)) {
                next.delete(node.path);
              } else {
                next.add(node.path);
              }
              return next;
            });
          }
          onSelect(node.path, node.kind);
        }}
        >
        <span className="tree-icon">
          {node.kind === "folder" ? (isExpanded ? "▾" : "▸") : node.kind === "graph" ? "◉" : "•"}
        </span>
        <span className="tree-label">{node.name}</span>
        {node.archived ? <span className="tree-badge archived">archived</span> : null}
      </button>
      {node.kind === "folder" && isExpanded ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              setExpandedFolders={setExpandedFolders}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DocEditorPane(props: {
  tab: DocTabState;
  onTogglePreview: () => void;
  onContentChange: (content: string) => void;
}) {
  const { tab, onTogglePreview, onContentChange } = props;
  const previewHtml = useMemo(() => marked.parse(tab.content) as string, [tab.content]);
  const monacoReadyRef = useRef(false);
  const [editorSlow, setEditorSlow] = useState(false);
  const [usePlainEditor, setUsePlainEditor] = useState(false);
  const [editorAttempt, setEditorAttempt] = useState(0);

  useEffect(() => {
    if (tab.preview) {
      return;
    }

    monacoReadyRef.current = false;
    setEditorSlow(false);
    setUsePlainEditor(false);

    const timeout = window.setTimeout(() => {
      if (!monacoReadyRef.current) {
        setEditorSlow(true);
      }
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [editorAttempt, tab.path, tab.preview]);

  return (
    <div className="doc-pane">
      <div className="doc-toolbar">
        <button onClick={onTogglePreview}>{tab.preview ? "Show Editor" : "Show Preview"}</button>
      </div>
      <div className="doc-surface">
        {tab.preview ? (
          <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : usePlainEditor ? (
          <div className="plain-editor-wrap">
            <div className="banner warning">
              <div>
                The rich editor did not finish loading in this VS Code webview, so the planner switched
                to a plain Markdown editor.
              </div>
              <button
                type="button"
                onClick={() => {
                  monacoReadyRef.current = false;
                  setEditorAttempt((attempt) => attempt + 1);
                }}
              >
                Retry Rich Editor
              </button>
            </div>
            <textarea
              aria-label="Markdown editor"
              className="plain-editor"
              value={tab.content}
              onChange={(event) => onContentChange(event.target.value)}
            />
          </div>
        ) : (
          <div className="rich-editor-wrap">
            {editorSlow ? (
              <div className="banner warning">
                <div>The rich editor is taking longer than expected to load in this webview.</div>
                <button type="button" onClick={() => setUsePlainEditor(true)}>
                  Use Plain Editor
                </button>
              </div>
            ) : null}
            <Editor
              key={`${tab.path}:${editorAttempt}`}
              height="100%"
              defaultLanguage="markdown"
              value={tab.content}
              theme="vs-dark"
              onMount={() => {
                monacoReadyRef.current = true;
                setEditorSlow(false);
              }}
              onChange={(value) => onContentChange(value ?? "")}
              loading={<div className="editor-loading">Loading rich editor...</div>}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                wordWrap: "on",
                lineNumbersMinChars: 3,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function GraphEditorPane(props: {
  tab: GraphTabState;
  onChange: (graph: PlannerGraph) => void;
  onSelectionChange: (selection: GraphSelection) => void;
}) {
  const { tab, onChange, onSelectionChange } = props;
  const graph = useMemo(() => normalizeGraph(tab.graph), [tab.graph]);
  const reactNodes = useMemo(() => makeReactNodes(graph), [graph.nodes]);
  const reactEdges = useMemo(() => makeReactEdges(graph), [graph.edges]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [draggingKind, setDraggingKind] = useState<GraphPaletteKind | null>(null);
  const [pendingFocusNodeId, setPendingFocusNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!flowInstance) {
      return;
    }

    if (graph.nodes.length > 0) {
      flowInstance.fitView({
        nodes: graph.nodes.map((node) => ({ id: node.id })),
        padding: 0.24,
        duration: 0,
        maxZoom: 1.1,
      });
      return;
    }

    if (graph.viewport) {
      flowInstance.setViewport(graph.viewport);
    }
  }, [flowInstance, tab.path, tab.revision]);

  useEffect(() => {
    if (!flowInstance || !pendingFocusNodeId) {
      return;
    }

    const node = graph.nodes.find((candidate) => candidate.id === pendingFocusNodeId);
    if (!node) {
      return;
    }

    flowInstance.fitView({
      nodes: [{ id: node.id }],
      padding: 1.2,
      duration: 180,
      maxZoom: 1.15,
    });
    setPendingFocusNodeId(null);
  }, [flowInstance, graph.nodes, graph.viewport, pendingFocusNodeId]);

  const addNodeAtPosition = (x: number, y: number) => {
    const nextNodeId = `node-${Date.now()}`;
    onChange({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: nextNodeId,
          label: "New Node",
          position: { x, y },
        },
      ],
    });
    onSelectionChange({ kind: "node", id: nextNodeId });
    setPendingFocusNodeId(nextNodeId);
  };

  const getDropPosition = (event: Pick<DragEvent, "clientX" | "clientY">): { x: number; y: number } => {
    if (flowInstance) {
      return flowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
    }

    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return {
        x: 120 + graph.nodes.length * 20,
        y: 120 + graph.nodes.length * 20,
      };
    }

    return {
      x: Math.max(event.clientX - bounds.left, 48),
      y: Math.max(event.clientY - bounds.top, 48),
    };
  };

  const getQuickAddPosition = (): { x: number; y: number } => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds && flowInstance) {
      return getDropPosition({
        clientX: bounds.left + bounds.width / 2 + graph.nodes.length * 18,
        clientY: bounds.top + bounds.height / 2 + graph.nodes.length * 18,
      });
    }

    return {
      x: 120 + graph.nodes.length * 20,
      y: 120 + graph.nodes.length * 20,
    };
  };

  const handleNodesChange = (changes: NodeChange[]) => {
    const persistedChanges = changes.filter(
      (change) => change.type !== "select" && change.type !== "dimensions",
    );
    if (persistedChanges.length === 0) {
      return;
    }

    const nextNodes = applyNodeChanges(persistedChanges, reactNodes);
    onChange(graphFromReactState(tab.graph, nextNodes as CanvasNode[], reactEdges));
  };

  const handleEdgesChange = (changes: EdgeChange[]) => {
    const persistedChanges = changes.filter((change) => change.type !== "select");
    if (persistedChanges.length === 0) {
      return;
    }

    const nextEdges = applyEdgeChanges(persistedChanges, reactEdges);
    onChange(graphFromReactState(tab.graph, reactNodes, nextEdges));
  };

  const handleConnect: OnConnect = (connection: Connection) => {
    const nextEdges = addEdge(
      {
        ...connection,
        id: `edge-${Date.now()}`,
      },
      reactEdges,
    );
    onChange(graphFromReactState(tab.graph, reactNodes, nextEdges));
  };

  const deleteSelection = () => {
    if (!tab.selection) {
      return;
    }

    switch (tab.selection.kind) {
      case "node":
        onChange({
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== tab.selection?.id),
          edges: graph.edges.filter(
            (edge) => edge.source !== tab.selection?.id && edge.target !== tab.selection?.id,
          ),
        });
        break;
      case "edge":
        onChange({
          ...graph,
          edges: graph.edges.filter((edge) => edge.id !== tab.selection?.id),
        });
        break;
    }
    onSelectionChange(null);
  };

  return (
    <div className="graph-pane">
      <div className="graph-toolbar graph-toolbar--builder">
        <div className="graph-toolbar-copy">
          <div className="graph-toolbar-title">Click or drag onto canvas</div>
          <div className="graph-toolbar-subtitle">
            Click to add a node in view, or drag it onto an exact spot in the graph.
          </div>
        </div>
        <div className="toolbar">
          <button
            onClick={() => {
              if (!flowInstance || graph.nodes.length === 0) {
                return;
              }
              flowInstance.fitView({
                nodes: graph.nodes.map((node) => ({ id: node.id })),
                padding: 0.24,
                duration: 180,
                maxZoom: 1.1,
              });
            }}
            disabled={!flowInstance || graph.nodes.length === 0}
          >
            Reset View
          </button>
          <button onClick={deleteSelection} disabled={!tab.selection}>
            Delete Selection
          </button>
        </div>
      </div>

      <div className="graph-builder">
        <aside className="graph-palette">
          {[
            {
              kind: "node" as const,
              title: "Node",
              description: "Components, concepts, interfaces",
            },
          ].map((item) => (
            <button
              key={item.kind}
              className={`graph-palette-item ${draggingKind === item.kind ? "dragging" : ""}`}
              draggable
              onClick={() => {
                const position = getQuickAddPosition();
                addNodeAtPosition(position.x, position.y);
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-planner-graph-item", item.kind);
                event.dataTransfer.effectAllowed = "copy";
                setDraggingKind(item.kind);
              }}
              onDragEnd={() => setDraggingKind(null)}
            >
              <span className="graph-palette-item__title">{item.title}</span>
              <span className="graph-palette-item__description">{item.description}</span>
            </button>
          ))}
        </aside>

        <div
          ref={canvasRef}
          className={`graph-canvas ${draggingKind ? "drag-active" : ""}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("application/x-planner-graph-item")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            const droppedKind = event.dataTransfer.getData("application/x-planner-graph-item") as
              | GraphPaletteKind
              | "";
            if (!droppedKind) {
              return;
            }

            event.preventDefault();
            const position = getDropPosition(event.nativeEvent);
            addNodeAtPosition(position.x, position.y);
            setDraggingKind(null);
          }}
        >
          {draggingKind ? (
            <div className="graph-drop-hint">Release to add a {draggingKind} here</div>
          ) : null}
          <ReactFlow
            nodes={reactNodes}
            edges={reactEdges}
            nodeTypes={graphNodeTypes}
            onInit={setFlowInstance}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={(_event, node) => {
              onSelectionChange(nodeSelectionFromCanvasNode(node as CanvasNode));
            }}
            onEdgeClick={(_event, edge) => {
              onSelectionChange({ kind: "edge", id: edge.id });
            }}
            onSelectionChange={(selection) => {
              const nodes = selection?.nodes ?? [];
              const edges = selection?.edges ?? [];
              const selectedNode = nodes.at(0) as CanvasNode | undefined;
              const selectedEdge = edges.at(0);
              if (selectedNode) {
                onSelectionChange(nodeSelectionFromCanvasNode(selectedNode));
              } else if (selectedEdge) {
                onSelectionChange({ kind: "edge", id: selectedEdge.id });
              } else {
                onSelectionChange(null);
              }
            }}
            onMoveEnd={(_event, viewport) => {
              onChange({
                ...graph,
                viewport,
              });
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(255,255,255,0.08)" gap={24} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

function GraphFallbackPane(props: {
  tab: GraphTabState;
  error: Error;
  onApplyGraph: (graph: PlannerGraph) => void;
  onRetryCanvas: () => void;
}) {
  const { tab, error, onApplyGraph, onRetryCanvas } = props;
  const [rawValue, setRawValue] = useState(() => JSON.stringify(normalizeGraph(tab.graph), null, 2));
  const [parseError, setParseError] = useState<string>();

  useEffect(() => {
    setRawValue(JSON.stringify(normalizeGraph(tab.graph), null, 2));
    setParseError(undefined);
  }, [tab.graph, tab.path, tab.revision]);

  const applyRawGraph = () => {
    try {
      const parsed = JSON.parse(rawValue) as PlannerGraph;
      onApplyGraph(normalizeGraph(parsed));
      setParseError(undefined);
    } catch (parseFailure) {
      setParseError(
        parseFailure instanceof Error ? parseFailure.message : "Failed to parse graph JSON.",
      );
    }
  };

  return (
    <div className="graph-pane">
      <div className="banner error">
        <div>
          The graph canvas crashed while rendering this entry. You can keep working in raw JSON and retry
          the canvas after applying changes.
          <div className="error-detail">{error.message || "Unknown graph rendering error."}</div>
        </div>
        <div className="toolbar">
          <button onClick={onRetryCanvas}>Retry Canvas</button>
          <button className="primary" onClick={applyRawGraph}>
            Apply JSON
          </button>
        </div>
      </div>
      {parseError ? <div className="banner warning">{parseError}</div> : null}
      <div className="graph-json-fallback">
        <textarea
          aria-label="Graph JSON editor"
          className="code-area raw-graph-editor"
          value={rawValue}
          onChange={(event) => setRawValue(event.target.value)}
        />
      </div>
    </div>
  );
}

function InspectorPane(props: {
  tab: TabState;
  onMetadataChange: (partial: Partial<MetadataDraft>) => void;
  onTabChange: (nextTab: TabState) => void;
  onReveal: () => void;
  onCopyPath: () => void;
}) {
  const { tab, onMetadataChange, onTabChange, onReveal, onCopyPath } = props;
  const metadataState = parseMetadataDraft(tab.metadataDraft);

  const updateJsonField = (
    currentValue: JsonObject | undefined,
    value: string,
  ): JsonObject | undefined => {
    if (!value.trim()) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return currentValue;
      }
      return parsed as JsonObject;
    } catch {
      return currentValue;
    }
  };

  function updateGraphSelection(selectionUpdater: (tab: GraphTabState) => GraphTabState): void {
    if (tab.kind !== "graph") {
      return;
    }
    onTabChange(selectionUpdater(tab));
  }

  const selectedNode =
    tab.kind === "graph" && tab.selection?.kind === "node"
      ? tab.graph.nodes.find((node) => node.id === tab.selection?.id)
      : undefined;
  const selectedEdge =
    tab.kind === "graph" && tab.selection?.kind === "edge"
      ? tab.graph.edges.find((edge) => edge.id === tab.selection?.id)
      : undefined;

  return (
    <div className="inspector-pane">
      <section className="inspector-section">
        <div className="section-header">
          <h2>Entry Metadata</h2>
          <div className="toolbar">
            <button onClick={onCopyPath}>Copy Path</button>
            <button onClick={onReveal}>Open in Finder</button>
          </div>
        </div>

        <label>
          Title
          <input
            value={tab.metadataDraft.title}
            onChange={(event) => onMetadataChange({ title: event.target.value })}
          />
        </label>
        <label>
          Tags
          <input
            value={tab.metadataDraft.tagsText}
            onChange={(event) => onMetadataChange({ tagsText: event.target.value })}
          />
        </label>
        <label>
          Summary
          <textarea
            value={tab.metadataDraft.summary}
            onChange={(event) => onMetadataChange({ summary: event.target.value })}
          />
        </label>
        <label>
          Extra Metadata (JSON)
          <textarea
            className="code-area"
            value={tab.metadataDraft.extraText}
            onChange={(event) => onMetadataChange({ extraText: event.target.value })}
          />
        </label>
        {metadataState.error ? <div className="banner error">{metadataState.error}</div> : null}
      </section>

      {tab.kind === "graph" ? (
        <section className="inspector-section">
          <h2>Graph Selection</h2>
          {selectedNode ? (
            <div className="selection-editor">
              <label>
                Label
                <input
                  value={selectedNode.label}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id ? { ...node, label: event.target.value } : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Body
                <textarea
                  value={selectedNode.body ?? ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id ? { ...node, body: event.target.value } : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Color
                <input
                  value={selectedNode.color ?? ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id ? { ...node, color: event.target.value } : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Links (comma-separated)
                <input
                  value={(selectedNode.links ?? []).join(", ")}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id
                            ? {
                                ...node,
                                links: event.target.value
                                  .split(",")
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              }
                            : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Annotations (JSON)
                <textarea
                  className="code-area"
                  value={selectedNode.annotations ? JSON.stringify(selectedNode.annotations, null, 2) : ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id
                            ? {
                                ...node,
                                annotations: updateJsonField(node.annotations, event.target.value),
                              }
                            : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Metadata (JSON)
                <textarea
                  className="code-area"
                  value={selectedNode.metadata ? JSON.stringify(selectedNode.metadata, null, 2) : ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        nodes: currentTab.graph.nodes.map((node) =>
                          node.id === selectedNode.id
                            ? {
                                ...node,
                                metadata: updateJsonField(node.metadata, event.target.value),
                              }
                            : node,
                        ),
                      },
                    }))
                  }
                />
              </label>
            </div>
          ) : null}

          {selectedEdge ? (
            <div className="selection-editor">
              <label>
                Label
                <input
                  value={selectedEdge.label ?? ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        edges: currentTab.graph.edges.map((edge) =>
                          edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Color
                <input
                  value={selectedEdge.color ?? ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        edges: currentTab.graph.edges.map((edge) =>
                          edge.id === selectedEdge.id ? { ...edge, color: event.target.value } : edge,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Metadata (JSON)
                <textarea
                  className="code-area"
                  value={selectedEdge.metadata ? JSON.stringify(selectedEdge.metadata, null, 2) : ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        edges: currentTab.graph.edges.map((edge) =>
                          edge.id === selectedEdge.id
                            ? {
                                ...edge,
                                metadata: updateJsonField(edge.metadata, event.target.value),
                              }
                            : edge,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <label>
                Annotations (JSON)
                <textarea
                  className="code-area"
                  value={selectedEdge.annotations ? JSON.stringify(selectedEdge.annotations, null, 2) : ""}
                  onChange={(event) =>
                    updateGraphSelection((currentTab) => ({
                      ...currentTab,
                      graph: {
                        ...currentTab.graph,
                        edges: currentTab.graph.edges.map((edge) =>
                          edge.id === selectedEdge.id
                            ? {
                                ...edge,
                                annotations: updateJsonField(edge.annotations, event.target.value),
                              }
                            : edge,
                        ),
                      },
                    }))
                  }
                />
              </label>
            </div>
          ) : null}

          {!selectedNode && !selectedEdge ? (
            <div className="empty-inline">
              Select a node or edge to edit graph annotations and metadata.
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CompileModal(props: {
  label: string;
  result: ProjectContextResult;
  onClose: () => void;
}) {
  const { label, result, onClose } = props;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <div className="eyebrow">Compiled Context</div>
            <h2>{label}</h2>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="modal-grid">
          <section>
            <h3>Summary</h3>
            <pre className="modal-pre">{result.summary}</pre>
          </section>
          <section>
            <h3>Bundle</h3>
            <pre className="modal-pre">{JSON.stringify(result.bundle, null, 2)}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function ActionModal(props: {
  dialog: ActionDialogState;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
  onChange: (value: string) => void;
}) {
  const { dialog, busy, error, onClose, onConfirm, onChange } = props;

  return (
    <div className="modal-overlay">
      <div className="modal-card action-modal-card">
        <div className="modal-header">
          <div>
            <div className="eyebrow">Planner Action</div>
            <h2>{dialog.title}</h2>
          </div>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-message">{dialog.message}</p>
          {dialog.kind === "text" ? (
            <label className="modal-field">
              {dialog.label}
              <input
                autoFocus
                value={dialog.value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          ) : null}
          {error ? <div className="banner error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={dialog.danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlannerApp;

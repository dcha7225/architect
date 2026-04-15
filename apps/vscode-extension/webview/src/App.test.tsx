import type {
  PlannerDocEntry,
  PlannerEntrySummary,
  PlannerGraphEntry,
  ProjectContextResult,
} from "@project-design-planner/planner-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { callPlanner, loadWebviewState, onPlannerEvent, saveWebviewState } from "./vscode";

let shouldThrowReactFlow = false;
let reactFlowInitialized = false;

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      aria-label="Markdown editor"
      data-testid="monaco-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock("reactflow", () => ({
  default: ({
    nodes,
    edges,
    children,
    onNodeClick,
    onEdgeClick,
    onSelectionChange,
    onInit,
    onConnect,
  }: {
    nodes?: Array<{ id: string; data?: { title?: string } }>;
    edges?: Array<{ id: string }>;
    children?: ReactNode;
    onNodeClick?: (event: unknown, node: { id: string; data?: { title?: string } }) => void;
    onEdgeClick?: (event: unknown, edge: { id: string }) => void;
    onSelectionChange?: (selection?: {
      nodes?: Array<{ id: string; data?: { title?: string } }>;
      edges?: Array<{ id: string }>;
    }) => void;
    onInit?: (instance: {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => { x: number; y: number };
      setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
      getViewport: () => { x: number; y: number; zoom: number };
      setCenter: (x: number, y: number, options?: { zoom?: number }) => void;
      fitView: (options?: {
        nodes?: Array<{ id: string }>;
        padding?: number;
        duration?: number;
        maxZoom?: number;
      }) => void;
    }) => void;
    onConnect?: (connection: {
      source: string | null;
      target: string | null;
      sourceHandle: string | null;
      targetHandle: string | null;
    }) => void;
  }) => (
    (() => {
      if (shouldThrowReactFlow) {
        throw new Error("React Flow crashed");
      }

      return (
        <ReactFlowMockInit onInit={onInit}>
          {(nodes ?? []).map((node) => (
            <button key={node.id} onClick={() => onNodeClick?.(undefined, node)}>
              {node.data?.title ?? node.id}
            </button>
          ))}
          {(edges ?? []).map((edge) => (
            <button key={edge.id} onClick={() => onEdgeClick?.(undefined, edge)}>
              {edge.id}
            </button>
          ))}
          <button onClick={() => onSelectionChange?.()}>Clear Selection</button>
          {(nodes ?? []).length >= 2 ? (
            <button
              onClick={() =>
                onConnect?.({
                  source: nodes?.[0]?.id ?? null,
                  target: nodes?.[1]?.id ?? null,
                  sourceHandle: null,
                  targetHandle: null,
                })
              }
            >
              Connect First Two
            </button>
          ) : null}
          {children}
        </ReactFlowMockInit>
      );
    })()
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: {
    Left: "left",
    Right: "right",
  },
  addEdge: (edge: { id?: string }, edges: Array<{ id: string }>) => [
    ...edges,
    {
      ...edge,
      id: edge.id ?? `edge-${edges.length + 1}`,
    },
  ],
  applyEdgeChanges: (_changes: unknown[], edges: unknown[]) => edges,
  applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes,
}));

function ReactFlowMockInit(props: {
  children: ReactNode;
  onInit?: (instance: {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => { x: number; y: number };
    setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
    getViewport: () => { x: number; y: number; zoom: number };
    setCenter: (x: number, y: number, options?: { zoom?: number }) => void;
    fitView: (options?: {
      nodes?: Array<{ id: string }>;
      padding?: number;
      duration?: number;
      maxZoom?: number;
    }) => void;
  }) => void;
}) {
  const { children, onInit } = props;

  useEffect(() => {
    if (!reactFlowInitialized) {
      reactFlowInitialized = true;
      let viewport = { x: 0, y: 0, zoom: 1 };
      onInit?.({
        screenToFlowPosition: ({ x, y }) => ({ x, y }),
        setViewport: (nextViewport) => {
          viewport = nextViewport;
        },
        getViewport: () => viewport,
        setCenter: (x, y, options) => {
          viewport = {
            x,
            y,
            zoom: options?.zoom ?? viewport.zoom,
          };
        },
        fitView: () => {
          viewport = { x: 0, y: 0, zoom: 1 };
        },
      });
    }
  }, [onInit]);

  return <div data-testid="reactflow-mock">{children}</div>;
}

vi.mock("./vscode", () => ({
  callPlanner: vi.fn(),
  loadWebviewState: vi.fn(),
  onPlannerEvent: vi.fn(),
  saveWebviewState: vi.fn(),
}));

vi.mock("./monaco", () => ({
  configureMonaco: vi.fn(),
}));

const callPlannerMock = vi.mocked(callPlanner);
const loadWebviewStateMock = vi.mocked(loadWebviewState);
const onPlannerEventMock = vi.mocked(onPlannerEvent);
const saveWebviewStateMock = vi.mocked(saveWebviewState);

const docEntry: PlannerDocEntry = {
  kind: "doc",
  name: "README.md",
  path: "README.md",
  archived: false,
  title: "Planning Workspace",
  summary: "Workspace overview",
  revision: "rev-doc-1",
  content: "# Planning Workspace\n\nInitial body.",
  metadata: {
    title: "Planning Workspace",
    summary: "Workspace overview",
    tags: ["overview"],
    updatedAt: "2026-04-14T20:00:00.000Z",
  },
};

const docSummary: PlannerEntrySummary = {
  kind: "doc",
  name: "README.md",
  path: "README.md",
  archived: false,
  title: docEntry.title,
  summary: docEntry.summary,
  tags: docEntry.metadata.tags,
  updatedAt: docEntry.metadata.updatedAt,
};

const archivedDocEntry: PlannerDocEntry = {
  ...docEntry,
  name: "old-plan.md",
  path: ".archive/old-plan.md",
  archived: true,
  title: "Old Plan",
  summary: "Archived planning note",
  revision: "rev-archived-1",
  content: "# Old Plan\n\nArchived content.",
  metadata: {
    title: "Old Plan",
    summary: "Archived planning note",
    tags: ["archived"],
    updatedAt: "2026-04-14T20:10:00.000Z",
  },
};

const archivedDocSummary: PlannerEntrySummary = {
  kind: "doc",
  name: "old-plan.md",
  path: ".archive/old-plan.md",
  archived: true,
  title: archivedDocEntry.title,
  summary: archivedDocEntry.summary,
  tags: archivedDocEntry.metadata.tags,
  updatedAt: archivedDocEntry.metadata.updatedAt,
};

const graphEntry: PlannerGraphEntry = {
  kind: "graph",
  name: "system.planner-graph.json",
  path: "system.planner-graph.json",
  archived: false,
  title: "System Design",
  summary: "Main planning graph",
  revision: "rev-graph-1",
  metadata: {
    title: "System Design",
    summary: "Main planning graph",
    tags: ["system", "graph"],
    updatedAt: "2026-04-14T20:00:00.000Z",
  },
  graph: {
    version: 1,
    metadata: {
      title: "System Design",
      summary: "Main planning graph",
      tags: ["system", "graph"],
      updatedAt: "2026-04-14T20:00:00.000Z",
    },
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
    },
    nodes: [
      {
        id: "api",
        label: "API",
        position: { x: 120, y: 120 },
      },
    ],
    edges: [],
  },
};

const graphSummary: PlannerEntrySummary = {
  kind: "graph",
  name: graphEntry.name,
  path: graphEntry.path,
  archived: false,
  title: graphEntry.title,
  summary: graphEntry.summary,
  tags: graphEntry.metadata.tags,
  updatedAt: graphEntry.metadata.updatedAt,
};

function createDataTransfer() {
  const data = new Map<string, string>();

  return {
    effectAllowed: "all",
    dropEffect: "move",
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return Array.from(data.keys());
    },
  };
}

describe("planner webview smoke tests", () => {
  beforeEach(() => {
    shouldThrowReactFlow = false;
    reactFlowInitialized = false;
    callPlannerMock.mockReset();
    loadWebviewStateMock.mockReset();
    onPlannerEventMock.mockReset();
    saveWebviewStateMock.mockReset();
    loadWebviewStateMock.mockReturnValue(undefined);
    onPlannerEventMock.mockReturnValue(() => {});
  });

  it("loads the workspace and saves a markdown document", async () => {
    callPlannerMock.mockImplementation(
      (async (method: string, payload: {
        content: string;
        metadata?: Record<string, unknown>;
        path?: string;
        includeArchived?: boolean;
      }) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Smoke Workspace",
              entries: [docSummary],
            };
          case "getEntry":
            expect(payload).toEqual({
              path: "README.md",
              includeArchived: true,
            });
            return {
              entry: docEntry,
            };
          case "updateDoc":
            return {
              entry: {
                ...docEntry,
                content: payload.content,
                revision: "rev-doc-2",
                metadata: {
                  ...docEntry.metadata,
                  ...payload.metadata,
                },
              },
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Smoke Workspace");
    const editor = await screen.findByTestId("monaco-editor");

    fireEvent.change(editor, {
      target: {
        value: "# Planning Workspace\n\nUpdated body.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(callPlannerMock).toHaveBeenCalledWith(
        "updateDoc",
        expect.objectContaining({
          path: "README.md",
          content: "# Planning Workspace\n\nUpdated body.",
          metadata: expect.objectContaining({
            title: "Planning Workspace",
            summary: "Workspace overview",
            tags: ["overview"],
          }),
        }),
      );
    });

    expect(await screen.findByText("Saved README.md")).toBeTruthy();
  });

  it("creates a document through the in-app action modal", async () => {
    callPlannerMock.mockImplementation(
      (async (method: string, payload: {
        path?: string;
        includeArchived?: boolean;
      }) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Create Workspace",
              entries: [docSummary],
            };
          case "getEntry":
            return {
              entry: docEntry,
            };
          case "createDoc":
            expect(payload.path).toBe("notes/feature-brief");
            return {
              entry: {
                ...docEntry,
                name: "feature-brief.md",
                path: "notes/feature-brief.md",
                title: "Feature Brief",
                summary: "New planning note",
                revision: "rev-doc-3",
                content: "# New Note\n\nCapture the key planning details here.\n",
                metadata: {
                  title: "Feature Brief",
                  summary: "New planning note",
                  tags: ["note"],
                  updatedAt: "2026-04-14T20:05:00.000Z",
                },
              },
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Create Workspace");

    fireEvent.click(screen.getByRole("button", { name: "New Doc" }));

    expect(await screen.findByText("Create Document")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Entry Path"), {
      target: { value: "notes/feature-brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Doc" }));

    await waitFor(() => {
      expect(callPlannerMock).toHaveBeenCalledWith(
        "createDoc",
        expect.objectContaining({
          path: "notes/feature-brief",
        }),
      );
    });

    expect(await screen.findByText("Created notes/feature-brief.md")).toBeTruthy();
  });

  it("shows archived entries with restore affordances", async () => {
    loadWebviewStateMock.mockReturnValue({
      activePath: ".archive/old-plan.md",
      selectedPath: ".archive/old-plan.md",
      showArchived: true,
    });

    callPlannerMock.mockImplementation(
      (async (method: string, payload: { path?: string; includeArchived?: boolean }) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Archive Workspace",
              entries: [archivedDocSummary],
            };
          case "getEntry":
            expect(payload).toEqual({
              path: ".archive/old-plan.md",
              includeArchived: true,
            });
            return {
              entry: archivedDocEntry,
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    const { container } = render(<App />);

    await screen.findByText("Archive Workspace");
    expect(await screen.findByText("Archived entry")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    const archivedTreeRow = container.querySelector(".tree-row.archived");
    const archivedTab = container.querySelector(".tab.archived");

    expect(archivedTreeRow).toBeTruthy();
    expect(archivedTab).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restore Archived Entry")).toBeTruthy();
  });

  it("adds nodes by drag and persists nodes and edges on save", async () => {
    callPlannerMock.mockImplementation(
      (async (method: string) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Graph Workspace",
              entries: [graphSummary],
            };
          case "getEntry":
            return {
              entry: graphEntry,
            };
          case "updateGraph":
            return {
              entry: {
                ...graphEntry,
                revision: "rev-graph-2",
              },
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Graph Workspace");
    await screen.findByText("Click or drag onto canvas");

    const canvas = document.querySelector(".graph-canvas");
    expect(canvas).toBeTruthy();
    const paletteNodeButton = screen.getAllByRole("button", { name: /Node/i }).at(0);
    expect(paletteNodeButton).toBeTruthy();
    if (!paletteNodeButton) {
      throw new Error("Expected node palette button");
    }

    const nodeTransfer = createDataTransfer();
    fireEvent.dragStart(paletteNodeButton, {
      dataTransfer: nodeTransfer,
    });
    fireEvent.dragOver(canvas!, { dataTransfer: nodeTransfer });
    fireEvent.drop(canvas!, {
      dataTransfer: nodeTransfer,
      clientX: 240,
      clientY: 220,
    });

    const secondNodeTransfer = createDataTransfer();
    fireEvent.dragStart(paletteNodeButton, {
      dataTransfer: secondNodeTransfer,
    });
    fireEvent.dragOver(canvas!, { dataTransfer: secondNodeTransfer });
    fireEvent.drop(canvas!, {
      dataTransfer: secondNodeTransfer,
      clientX: 320,
      clientY: 260,
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "New Node" })).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect First Two" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const updateGraphCall = callPlannerMock.mock.calls.find(([method]) => method === "updateGraph");
      expect(updateGraphCall).toBeDefined();
      expect((updateGraphCall?.[1] as { graph: PlannerGraphEntry["graph"] }).graph.nodes).toHaveLength(3);
      expect((updateGraphCall?.[1] as { graph: PlannerGraphEntry["graph"] }).graph.edges).toHaveLength(1);
    });
  });

  it("adds a node to the canvas when the node palette card is clicked", async () => {
    callPlannerMock.mockImplementation(
      (async (method: string) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Click Workspace",
              entries: [graphSummary],
            };
          case "getEntry":
            return {
              entry: graphEntry,
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Click Workspace");
    await screen.findByText("Click or drag onto canvas");

    fireEvent.click(screen.getByRole("button", { name: /Node/i }));

    expect(await screen.findByRole("button", { name: "New Node" })).toBeTruthy();
  });

  it("does not crash when React Flow clears selection without a payload", async () => {
    callPlannerMock.mockImplementation(
      (async (method: string) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Selection Workspace",
              entries: [graphSummary],
            };
          case "getEntry":
            return {
              entry: graphEntry,
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Selection Workspace");
    await screen.findByText("Click or drag onto canvas");

    fireEvent.click(screen.getByRole("button", { name: "Clear Selection" }));

    expect(screen.getByText("Graph Selection")).toBeTruthy();
    expect(screen.getByText("Select a node or edge to edit graph annotations and metadata.")).toBeTruthy();
  });

  it("falls back to raw graph JSON when the canvas crashes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrowReactFlow = true;

    callPlannerMock.mockImplementation(
      (async (method: string) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Fallback Workspace",
              entries: [graphSummary],
            };
          case "getEntry":
            return {
              entry: graphEntry,
            };
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Fallback Workspace");
    expect(
      await screen.findByText("The graph canvas crashed while rendering this entry. You can keep working in raw JSON and retry the canvas after applying changes."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Graph JSON editor")).toBeTruthy();

    consoleError.mockRestore();
  });

  it("compiles the workspace and shows the context modal", async () => {
    const compileResult: ProjectContextResult = {
      summary: "Compiled planning summary",
      bundle: {
        generatedAt: "2026-04-14T20:00:00.000Z",
        scopePaths: ["README.md"],
        documents: [
          {
            path: "README.md",
            title: "Planning Workspace",
            summary: "Workspace overview",
            tags: ["overview"],
            updatedAt: "2026-04-14T20:00:00.000Z",
            content: "# Planning Workspace\n\nInitial body.",
          },
        ],
        graphs: [],
        entities: [],
        relationships: [],
        requirements: [],
        constraints: [],
        decisions: [],
        flows: [],
        openQuestions: [],
      },
    };

    callPlannerMock.mockImplementation(
      (async (method: string) => {
        switch (method) {
          case "initialize":
            return {
              workspaceName: "Compile Workspace",
              entries: [docSummary],
            };
          case "getEntry":
            return {
              entry: docEntry,
            };
          case "compileContext":
            return compileResult;
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      }) as never,
    );

    render(<App />);

    await screen.findByText("Compile Workspace");

    fireEvent.click(screen.getByRole("button", { name: "Compile Workspace" }));

    expect(await screen.findByText("Compiled Context")).toBeTruthy();
    expect(await screen.findByText("Compiled planning summary")).toBeTruthy();
    expect(await screen.findByText(/"scopePaths": \[/)).toBeTruthy();
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  archiveEntry,
  compileContext,
  createDoc,
  createGraph,
  getEntry,
  initializeProjectDocs,
  listEntries,
  restoreEntry,
} from "../src/index.js";

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "planner-core-"));
  tempDirs.push(workspaceRoot);
  await initializeProjectDocs(workspaceRoot);
  return workspaceRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("planner-core storage", () => {
  it("creates docs and graphs and lists them as planner entries", async () => {
    const workspaceRoot = await createWorkspace();

    await createDoc(
      workspaceRoot,
      "notes/product-vision",
      "# Product Vision\n\nThe planner should support free-form narrative design docs.",
      {
        tags: ["vision", "docs"],
      },
    );

    await createGraph(workspaceRoot, "designs/system-map", {
      version: 1,
      metadata: {
        title: "System Map",
        summary: "High-level system map",
      },
      nodes: [
        {
          id: "node-1",
          label: "Planner UI",
          position: { x: 100, y: 120 },
        },
      ],
      edges: [],
      groups: [],
    });

    const entries = await listEntries(workspaceRoot, { includeArchived: true });
    const entryPaths = entries.map((entry) => entry.path);

    expect(entryPaths).toContain("README.md");
    expect(entryPaths).toContain("notes");
    expect(entryPaths).toContain("notes/product-vision.md");
    expect(entryPaths).toContain("designs/system-map.planner-graph.json");

    const docEntry = await getEntry(workspaceRoot, "notes/product-vision.md");
    expect(docEntry.kind).toBe("doc");
    if (docEntry.kind === "doc") {
      expect(docEntry.metadata.tags).toEqual(["vision", "docs"]);
      expect(docEntry.title).toBe("Product Vision");
    }
  });

  it("archives and restores docs with collision-safe names and compiles context", async () => {
    const workspaceRoot = await createWorkspace();

    await createDoc(
      workspaceRoot,
      "specs/requirements",
      "# Requirements\n\n- The planner must support agent-readable context.\n- Open question: should context be persisted?\n",
      {
        tags: ["requirements"],
      },
    );

    await createGraph(workspaceRoot, "graphs/architecture", {
      version: 1,
      metadata: {
        title: "Architecture",
      },
      nodes: [
        {
          id: "ui",
          label: "Planner UI",
          position: { x: 80, y: 80 },
          annotations: {
            kind: "component",
          },
        },
        {
          id: "decision",
          label: "Decision: use atomic writes",
          position: { x: 280, y: 80 },
          annotations: {
            kind: "decision",
          },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "ui",
          target: "decision",
          label: "depends on",
        },
      ],
      groups: [],
    });

    const archived = await archiveEntry(workspaceRoot, "specs/requirements.md");
    expect(archived.path.startsWith(".archive/")).toBe(true);

    await createDoc(
      workspaceRoot,
      "specs/requirements",
      "# Requirements\n\nA replacement file occupies the original path.\n",
    );

    const restored = await restoreEntry(workspaceRoot, archived.path);
    expect(restored.path).toBe("specs/requirements-1.md");

    const compiled = await compileContext(workspaceRoot);
    expect(compiled.bundle.documents.length).toBeGreaterThanOrEqual(2);
    expect(compiled.bundle.graphs).toHaveLength(1);
    expect(compiled.bundle.decisions.some((item) => item.title.includes("Decision"))).toBe(true);
    expect(compiled.summary).toContain("Project Context");

    const restoredFile = await readFile(
      path.join(workspaceRoot, ".project-docs", "specs", "requirements-1.md"),
      "utf8",
    );
    expect(restoredFile).toContain("agent-readable context");
  });
});

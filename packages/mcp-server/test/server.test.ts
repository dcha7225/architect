import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createPlannerMcpServer } from "../src/server.js";

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "planner-mcp-"));
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

function readStructuredText(result: {
  content?: Array<{
    type: string;
    text?: string;
  }>;
}): unknown {
  const firstText = result.content?.find((item) => item.type === "text")?.text;
  expect(firstText).toBeTruthy();
  return JSON.parse(firstText ?? "{}");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("planner MCP server", () => {
  it("lists tools and performs document + compile operations over MCP", async () => {
    const workspaceRoot = await createWorkspace();
    const server = createPlannerMcpServer(workspaceRoot);
    const client = new Client(
      {
        name: "planner-test-client",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listedTools = await client.listTools();
    expect(listedTools.tools.some((tool) => tool.name === "create_doc")).toBe(true);
    expect(listedTools.tools.some((tool) => tool.name === "compile_context")).toBe(true);

    await client.callTool({
      name: "create_doc",
      arguments: {
        path: "notes/plan",
        content: "# Plan\n\nThe planner must provide an MCP surface.",
      },
    });

    await client.callTool({
      name: "create_graph",
      arguments: {
        path: "graphs/flow",
        graph: {
          version: 1,
          metadata: {
            title: "Flow",
          },
          nodes: [
            {
              id: "node-1",
              label: "Planner",
              position: { x: 120, y: 120 },
              annotations: {
                kind: "component",
              },
            },
          ],
          edges: [],
        },
      },
    });

    const compiled = await client.callTool({
      name: "compile_context",
      arguments: {},
    });
    const parsed = readStructuredText(compiled) as {
      bundle: {
        documents: Array<{ path: string }>;
        graphs: Array<{ path: string }>;
      };
      summary: string;
    };

    expect(parsed.bundle.documents.some((doc) => doc.path === "notes/plan.md")).toBe(true);
    expect(parsed.bundle.graphs.some((graph) => graph.path === "graphs/flow.planner-graph.json")).toBe(
      true,
    );
    expect(parsed.summary).toContain("Project Context");

    await client.close();
  });
});

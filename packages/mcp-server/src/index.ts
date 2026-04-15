#!/usr/bin/env node
import { argv, cwd, exit } from "node:process";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createPlannerMcpServer } from "./server.js";

function getWorkspaceRoot(): string {
  const workspaceFlagIndex = argv.findIndex((value) => value === "--workspace");
  if (workspaceFlagIndex >= 0) {
    const workspace = argv[workspaceFlagIndex + 1];
    if (!workspace) {
      throw new Error("Missing value for --workspace");
    }
    return workspace;
  }

  return cwd();
}

async function main(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  const server = createPlannerMcpServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Project Design Planner MCP server ready for ${workspaceRoot}`);
}

main().catch((error: unknown) => {
  console.error("Project Design Planner MCP server failed:", error);
  exit(1);
});

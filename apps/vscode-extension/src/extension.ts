import path from "node:path";

import * as vscode from "vscode";

import { PlannerPanel } from "./panel.js";

function getMcpServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "dist", "mcp-server.js");
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("projectDesignPlanner.openPlanner", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspaceRoot) {
        void vscode.window.showErrorMessage(
          "Project Design Planner needs an open workspace folder to store .project-docs.",
        );
        return;
      }

      await PlannerPanel.createOrShow(context, workspaceRoot);
    }),

    vscode.commands.registerCommand("projectDesignPlanner.copyMcpConfig", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        void vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }

      const serverPath = getMcpServerPath(context);
      const config = JSON.stringify(
        {
          mcpServers: {
            "project-design-planner": {
              command: "node",
              args: [serverPath, "--workspace", workspaceRoot],
            },
          },
        },
        null,
        2,
      );

      await vscode.env.clipboard.writeText(config);
      void vscode.window.showInformationMessage(
        "MCP config copied to clipboard. Paste it into .mcp.json in your project root or your Claude Code settings.",
      );
    }),
  );
}

export function deactivate(): void {}

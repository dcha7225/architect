import * as vscode from "vscode";

import { PlannerPanel } from "./panel.js";

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
  );
}

export function deactivate(): void {}

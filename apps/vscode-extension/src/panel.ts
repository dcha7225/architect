import { promises as fs } from "node:fs";
import path from "node:path";

import {
  archiveEntry,
  compileContext,
  createDoc,
  createFolder,
  createGraph,
  duplicateEntry,
  getEntry,
  initializeProjectDocs,
  listEntries,
  moveEntry,
  resolveEntryAbsolutePath,
  restoreEntry,
  toEntryPath,
  updateDoc,
  updateGraph,
} from "@project-design-planner/planner-core";
import * as vscode from "vscode";

import type {
  PlannerClientMessage,
  PlannerRequestMethod,
  PlannerRequestMessage,
  PlannerResponseMessage,
  PlannerServerEventMessage,
} from "./shared/messages.js";

export class PlannerPanel {
  private static currentPanel: PlannerPanel | undefined;

  static async createOrShow(context: vscode.ExtensionContext, workspaceRoot: string): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (PlannerPanel.currentPanel) {
      PlannerPanel.currentPanel.panel.reveal(column);
      await PlannerPanel.currentPanel.postEntriesChanged();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "projectDesignPlanner",
      "Project Design Planner",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.file(workspaceRoot),
        ],
      },
    );

    PlannerPanel.currentPanel = new PlannerPanel(panel, context, workspaceRoot);
    await PlannerPanel.currentPanel.initialize();
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcher: vscode.FileSystemWatcher;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string,
  ) {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(workspaceRoot), ".project-docs/**/*");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
  }

  private async initialize(): Promise<void> {
    await initializeProjectDocs(this.workspaceRoot);
    this.panel.webview.html = await this.getWebviewHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message: PlannerClientMessage) => {
        if (message.type !== "request") {
          return;
        }

        await this.handleRequest(message);
      },
      null,
      this.disposables,
    );

    const handleWatcherEvent = async (uri: vscode.Uri): Promise<void> => {
      await this.postEntriesChanged(uri);
    };

    this.watcher.onDidCreate(handleWatcherEvent, null, this.disposables);
    this.watcher.onDidChange(handleWatcherEvent, null, this.disposables);
    this.watcher.onDidDelete(handleWatcherEvent, null, this.disposables);
    this.disposables.push(this.watcher);

    await this.postEntriesChanged();
  }

  private dispose(): void {
    PlannerPanel.currentPanel = undefined;
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private async getWebviewHtml(): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "index.html");

    try {
      let html = await fs.readFile(htmlPath.fsPath, "utf8");
      const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");

      html = html.replace(/__CSP_SOURCE__/g, this.panel.webview.cspSource);
      html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_match, attribute, assetPath) => {
        const assetUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, assetPath));
        return `${attribute}="${assetUri.toString()}"`;
      });

      return html;
    } catch {
      return `<!doctype html>
<html lang="en">
  <body>
    <h1>Project Design Planner</h1>
    <p>The webview bundle is missing. Run the extension build to generate <code>dist/webview</code>.</p>
  </body>
</html>`;
    }
  }

  private async postResponse(message: PlannerResponseMessage | Record<string, unknown>): Promise<void> {
    await this.panel.webview.postMessage(message);
  }

  private async postEvent(message: PlannerServerEventMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
  }

  private async postEntriesChanged(changedUri?: vscode.Uri): Promise<void> {
    const entries = await listEntries(this.workspaceRoot, { includeArchived: true });
    let changedPath: string | undefined;

    if (changedUri) {
      try {
        changedPath = toEntryPath(this.workspaceRoot, changedUri.fsPath);
      } catch {
        changedPath = undefined;
      }
    }

    await this.postEvent({
      type: "event",
      event: "entriesChanged",
      payload: {
        entries,
        changedPath,
      },
    });
  }

  private async handleRequest(message: PlannerRequestMessage): Promise<void> {
    try {
      const result = await this.dispatch(message.method, message.payload);
      await this.postResponse({
        type: "response",
        id: message.id,
        ok: true,
        result,
      });
    } catch (error) {
      await this.postResponse({
        type: "response",
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown planner error",
      });
    }
  }

  private async dispatch(method: PlannerRequestMethod, payload: unknown): Promise<unknown> {
    switch (method) {
      case "initialize": {
        await initializeProjectDocs(this.workspaceRoot);
        const entries = await listEntries(this.workspaceRoot, { includeArchived: true });
        return {
          workspaceName: path.basename(this.workspaceRoot),
          entries,
        };
      }
      case "getEntry": {
        const { path: entryPath, includeArchived } = payload as {
          path: string;
          includeArchived?: boolean;
        };
        return {
          entry: await getEntry(this.workspaceRoot, entryPath, includeArchived ?? true),
        };
      }
      case "createFolder": {
        const { path: folderPath } = payload as { path: string };
        const createdPath = await createFolder(this.workspaceRoot, folderPath);
        await this.postEntriesChanged();
        return { path: createdPath };
      }
      case "createDoc": {
        const { path: entryPath, content, metadata } = payload as {
          path: string;
          content?: string;
          metadata?: Record<string, unknown>;
        };
        const entry = await createDoc(this.workspaceRoot, entryPath, content ?? "", metadata);
        await this.postEntriesChanged();
        return { entry };
      }
      case "createGraph": {
        const { path: entryPath, graph } = payload as {
          path: string;
          graph?: Parameters<typeof createGraph>[2];
        };
        const entry = await createGraph(this.workspaceRoot, entryPath, graph);
        await this.postEntriesChanged();
        return { entry };
      }
      case "updateDoc": {
        const { path: entryPath, content, metadata } = payload as {
          path: string;
          content: string;
          metadata?: Record<string, unknown>;
        };
        const entry = await updateDoc(this.workspaceRoot, entryPath, content, metadata);
        await this.postEntriesChanged();
        return { entry };
      }
      case "updateGraph": {
        const { path: entryPath, graph } = payload as {
          path: string;
          graph: Parameters<typeof updateGraph>[2];
        };
        const entry = await updateGraph(this.workspaceRoot, entryPath, graph);
        await this.postEntriesChanged();
        return { entry };
      }
      case "moveEntry": {
        const { path: entryPath, newPath } = payload as { path: string; newPath: string };
        const entry = await moveEntry(this.workspaceRoot, entryPath, newPath);
        await this.postEntriesChanged();
        return { entry };
      }
      case "duplicateEntry": {
        const { path: entryPath, newPath } = payload as { path: string; newPath?: string };
        const entry = await duplicateEntry(this.workspaceRoot, entryPath, newPath);
        await this.postEntriesChanged();
        return { entry };
      }
      case "archiveEntry": {
        const { path: entryPath } = payload as { path: string };
        const entry = await archiveEntry(this.workspaceRoot, entryPath);
        await this.postEntriesChanged();
        return { entry };
      }
      case "restoreEntry": {
        const { path: entryPath, restorePath } = payload as {
          path: string;
          restorePath?: string;
        };
        const entry = await restoreEntry(this.workspaceRoot, entryPath, restorePath);
        await this.postEntriesChanged();
        return { entry };
      }
      case "compileContext": {
        const { entryPaths } = (payload as { entryPaths?: string[] }) ?? {};
        return compileContext(this.workspaceRoot, { entryPaths });
      }
      case "revealInExplorer": {
        const { path: entryPath } = payload as { path: string };
        const uri = vscode.Uri.file(resolveEntryAbsolutePath(this.workspaceRoot, entryPath));
        await vscode.commands.executeCommand("revealFileInOS", uri);
        return { revealed: entryPath };
      }
      default: {
        const neverMethod: never = method;
        throw new Error(`Unsupported planner method: ${neverMethod}`);
      }
    }
  }
}

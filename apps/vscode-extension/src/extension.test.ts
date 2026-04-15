import * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registerCommandMock = vi.fn();
const showErrorMessageMock = vi.fn();
const createOrShowMock = vi.fn();
const vscodeState = vscode as unknown as {
  commands: {
    registerCommand: typeof registerCommandMock;
  };
  window: {
    showErrorMessage: typeof showErrorMessageMock;
  };
  workspace: {
    workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined;
  };
};

vi.mock("./panel.js", () => ({
  PlannerPanel: {
    createOrShow: createOrShowMock,
  },
}));

describe("extension activation", () => {
  beforeEach(() => {
    registerCommandMock.mockReset();
    showErrorMessageMock.mockReset();
    createOrShowMock.mockReset();
    vscodeState.commands.registerCommand = registerCommandMock;
    vscodeState.window.showErrorMessage = showErrorMessageMock;
    vscodeState.workspace.workspaceFolders = undefined;
  });

  it("shows an error when no workspace is open", async () => {
    const { activate } = await import("./extension.js");
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    let handler: (() => Promise<void>) | undefined;
    registerCommandMock.mockImplementation((_command: string, callback: () => Promise<void>) => {
      handler = callback;
      return { dispose() {} };
    });

    activate(context as never);
    expect(context.subscriptions).toHaveLength(1);

    await handler?.();

    expect(showErrorMessageMock).toHaveBeenCalledWith(
      "Project Design Planner needs an open workspace folder to store .project-docs.",
    );
    expect(createOrShowMock).not.toHaveBeenCalled();
  });

  it("opens the planner panel for the current workspace", async () => {
    const { activate } = await import("./extension.js");
    const context = { subscriptions: [] as Array<{ dispose(): void }> };

    let handler: (() => Promise<void>) | undefined;
    registerCommandMock.mockImplementation((_command: string, callback: () => Promise<void>) => {
      handler = callback;
      return { dispose() {} };
    });

    vscodeState.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/tmp/planner-workspace",
        },
      },
    ];

    activate(context as never);
    await handler?.();

    expect(createOrShowMock).toHaveBeenCalledWith(context, "/tmp/planner-workspace");
    expect(showErrorMessageMock).not.toHaveBeenCalled();
  });
});

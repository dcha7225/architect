export const commands = {
  registerCommand: () => ({
    dispose() {},
  }),
};

export const window = {
  showErrorMessage: () => undefined,
};

export const workspace = {
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
};

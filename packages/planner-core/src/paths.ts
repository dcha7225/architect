import path from "node:path";

export const PROJECT_DOCS_DIR = ".project-docs";
export const ARCHIVE_DIR = ".archive";
export const GRAPH_EXTENSION = ".planner-graph.json";
export const DOC_EXTENSION = ".md";

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeRelativeEntryPath(entryPath: string): string {
  const trimmed = normalizeSlashPath(entryPath).replace(/^\/+/, "").trim();
  if (!trimmed) {
    throw new Error("Entry path cannot be empty.");
  }

  const withoutPrefix = trimmed.startsWith(`${PROJECT_DOCS_DIR}/`)
    ? trimmed.slice(PROJECT_DOCS_DIR.length + 1)
    : trimmed;
  const normalized = path.posix.normalize(withoutPrefix);

  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Unsafe entry path: ${entryPath}`);
  }

  return normalized;
}

export function isGraphPath(entryPath: string): boolean {
  return normalizeSlashPath(entryPath).endsWith(GRAPH_EXTENSION);
}

export function isDocPath(entryPath: string): boolean {
  return normalizeSlashPath(entryPath).endsWith(DOC_EXTENSION);
}

export function ensureDocPath(entryPath: string): string {
  const normalized = normalizeRelativeEntryPath(entryPath);
  return isDocPath(normalized) ? normalized : `${normalized}${DOC_EXTENSION}`;
}

export function ensureGraphPath(entryPath: string): string {
  const normalized = normalizeRelativeEntryPath(entryPath);
  return isGraphPath(normalized) ? normalized : `${normalized}${GRAPH_EXTENSION}`;
}

export function isArchivedPath(entryPath: string): boolean {
  const normalized = normalizeRelativeEntryPath(entryPath);
  return normalized === ARCHIVE_DIR || normalized.startsWith(`${ARCHIVE_DIR}/`);
}

export function getProjectDocsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, PROJECT_DOCS_DIR);
}

export function getArchiveRoot(workspaceRoot: string): string {
  return path.join(getProjectDocsRoot(workspaceRoot), ARCHIVE_DIR);
}

export function resolveEntryAbsolutePath(workspaceRoot: string, entryPath: string): string {
  const normalized = normalizeRelativeEntryPath(entryPath);
  const root = getProjectDocsRoot(workspaceRoot);
  const absolute = path.resolve(root, normalized);

  if (!absolute.startsWith(root)) {
    throw new Error(`Entry path escapes the project docs directory: ${entryPath}`);
  }

  return absolute;
}

export function toEntryPath(workspaceRoot: string, absolutePath: string): string {
  const root = getProjectDocsRoot(workspaceRoot);
  const relative = normalizeSlashPath(path.relative(root, absolutePath));
  return normalizeRelativeEntryPath(relative);
}

export function stripArchivePrefix(entryPath: string): string {
  const normalized = normalizeRelativeEntryPath(entryPath);
  return normalized.startsWith(`${ARCHIVE_DIR}/`)
    ? normalized.slice(ARCHIVE_DIR.length + 1)
    : normalized;
}

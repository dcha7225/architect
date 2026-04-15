import { promises as fs } from "node:fs";
import path from "node:path";

import { compileProjectContext } from "./compiler.js";
import { createEmptyGraph, parseGraphDocument, serializeGraphDocument } from "./graph.js";
import { parseMarkdownDocument, serializeMarkdownDocument } from "./markdown.js";
import { deriveSummary, deriveTitleFromContent, normalizeMetadata } from "./metadata.js";
import {
  ARCHIVE_DIR,
  ensureDocPath,
  ensureGraphPath,
  getArchiveRoot,
  getProjectDocsRoot,
  isArchivedPath,
  isDocPath,
  isGraphPath,
  normalizeRelativeEntryPath,
  resolveEntryAbsolutePath,
  stripArchivePrefix,
  toEntryPath,
} from "./paths.js";
import { plannerGraphSchema } from "./schemas.js";
import type {
  CompileContextOptions,
  JsonObject,
  ListEntriesOptions,
  PlannerDocEntry,
  PlannerEntry,
  PlannerEntrySummary,
  PlannerGraph,
  PlannerGraphEntry,
  PlannerMetadata,
  ProjectContextResult,
} from "./types.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const directory = path.dirname(targetPath);
  await ensureDirectory(directory);

  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, targetPath);
  } finally {
    if (await pathExists(tempPath)) {
      await fs.unlink(tempPath);
    }
  }
}

async function ensureUniquePath(targetPath: string): Promise<string> {
  if (!(await pathExists(targetPath))) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let counter = 1;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
}

function isPlannerFile(entryPath: string): boolean {
  return isDocPath(entryPath) || isGraphPath(entryPath);
}

async function readEntryFromFile(workspaceRoot: string, absolutePath: string): Promise<PlannerEntry> {
  const stats = await fs.stat(absolutePath);
  const entryPath = toEntryPath(workspaceRoot, absolutePath);
  const archived = isArchivedPath(entryPath);

  if (stats.isDirectory()) {
    return {
      kind: "folder",
      name: path.basename(absolutePath),
      path: entryPath,
      archived,
    };
  }

  const raw = await fs.readFile(absolutePath, "utf8");
  if (isDocPath(entryPath)) {
    return parseMarkdownDocument(raw, {
      path: entryPath,
      archived,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  }

  if (isGraphPath(entryPath)) {
    return parseGraphDocument(raw, {
      path: entryPath,
      archived,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  }

  throw new Error(`Unsupported planner entry: ${entryPath}`);
}

async function walkEntries(
  workspaceRoot: string,
  directoryPath: string,
  options: ListEntriesOptions,
): Promise<PlannerEntrySummary[]> {
  if (!(await pathExists(directoryPath))) {
    return [];
  }

  const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
  const entries: PlannerEntrySummary[] = [];

  for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
    if (dirent.name === ".tmp") {
      continue;
    }

    const absolutePath = path.join(directoryPath, dirent.name);
    const entryPath = toEntryPath(workspaceRoot, absolutePath);
    const archived = isArchivedPath(entryPath);

    if (!options.includeArchived && archived) {
      continue;
    }

    if (dirent.isDirectory()) {
      entries.push({
        kind: "folder",
        name: dirent.name,
        path: entryPath,
        archived,
      });
      entries.push(...(await walkEntries(workspaceRoot, absolutePath, options)));
      continue;
    }

    if (!isPlannerFile(entryPath)) {
      continue;
    }

    const entry = await readEntryFromFile(workspaceRoot, absolutePath);
    if (entry.kind === "folder") {
      continue;
    }

    entries.push({
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      archived: entry.archived,
      title: entry.title,
      summary: entry.summary,
      tags: entry.metadata.tags,
      updatedAt: entry.metadata.updatedAt,
    });
  }

  return entries;
}

async function readExistingEntriesInScope(
  workspaceRoot: string,
  entryPaths?: string[],
): Promise<PlannerEntry[]> {
  if (!entryPaths || entryPaths.length === 0) {
    const listed = await listEntries(workspaceRoot, { includeArchived: false });
    const files = listed.filter((entry) => entry.kind !== "folder");
    return Promise.all(files.map((entry) => getEntry(workspaceRoot, entry.path)));
  }

  const expanded = new Set<string>();

  for (const requestedPath of entryPaths) {
    const normalized = normalizeRelativeEntryPath(requestedPath);
    const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
    const stats = await fs.stat(absolutePath);

    if (stats.isDirectory()) {
      const nested = await walkEntries(workspaceRoot, absolutePath, { includeArchived: true });
      nested
        .filter((entry) => entry.kind !== "folder")
        .forEach((entry) => expanded.add(entry.path));
    } else {
      expanded.add(normalized);
    }
  }

  return Promise.all(Array.from(expanded).map((entryPath) => getEntry(workspaceRoot, entryPath, true)));
}

export async function initializeProjectDocs(workspaceRoot: string): Promise<void> {
  const docsRoot = getProjectDocsRoot(workspaceRoot);
  const archiveRoot = getArchiveRoot(workspaceRoot);

  await ensureDirectory(docsRoot);
  await ensureDirectory(archiveRoot);

  const readmePath = path.join(docsRoot, "README.md");
  if (!(await pathExists(readmePath))) {
    const metadata = normalizeMetadata(
      {
        title: "Planning Workspace",
        summary: "Use this folder for free-form planning docs and graph artifacts.",
        tags: ["planner", "overview"],
      },
      {
        fallbackTitle: "Planning Workspace",
        fallbackSummary: "Use this folder for free-form planning docs and graph artifacts.",
        updatedAt: new Date().toISOString(),
      },
    );
    await atomicWriteFile(
      readmePath,
      serializeMarkdownDocument(
        "# Planning Workspace\n\nCreate docs and graph artifacts here to shape the project before implementation.\n",
        metadata,
      ),
    );
  }
}

export async function listEntries(
  workspaceRoot: string,
  options: ListEntriesOptions = {},
): Promise<PlannerEntrySummary[]> {
  const docsRoot = getProjectDocsRoot(workspaceRoot);
  await initializeProjectDocs(workspaceRoot);
  return walkEntries(workspaceRoot, docsRoot, options);
}

export async function getEntry(
  workspaceRoot: string,
  entryPath: string,
  includeArchived = false,
): Promise<PlannerEntry> {
  const normalized = normalizeRelativeEntryPath(entryPath);
  if (!includeArchived && isArchivedPath(normalized)) {
    throw new Error(`Archived entry is not available without includeArchived: ${entryPath}`);
  }

  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  return readEntryFromFile(workspaceRoot, absolutePath);
}

export async function createFolder(workspaceRoot: string, folderPath: string): Promise<string> {
  const normalized = normalizeRelativeEntryPath(folderPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  await ensureDirectory(absolutePath);
  return normalized;
}

export async function createDoc(
  workspaceRoot: string,
  entryPath: string,
  content = "",
  metadata?: Record<string, unknown>,
): Promise<PlannerDocEntry> {
  await initializeProjectDocs(workspaceRoot);
  const normalized = ensureDocPath(entryPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  if (await pathExists(absolutePath)) {
    throw new Error(`Document already exists: ${normalized}`);
  }

  const title = deriveTitleFromContent(content, path.basename(normalized, ".md"));
  const normalizedMetadata = normalizeMetadata(metadata, {
    fallbackTitle: title,
    fallbackSummary: deriveSummary(content, "Planning document"),
    updatedAt: new Date().toISOString(),
  });

  await atomicWriteFile(absolutePath, serializeMarkdownDocument(content, normalizedMetadata));
  return getEntry(workspaceRoot, normalized) as Promise<PlannerDocEntry>;
}

export async function createGraph(
  workspaceRoot: string,
  entryPath: string,
  graph?: PlannerGraph,
): Promise<PlannerGraphEntry> {
  await initializeProjectDocs(workspaceRoot);
  const normalized = ensureGraphPath(entryPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  if (await pathExists(absolutePath)) {
    throw new Error(`Graph already exists: ${normalized}`);
  }

  const defaultGraph = createEmptyGraph(path.basename(normalized, ".planner-graph.json"));
  const mergedGraph = plannerGraphSchema.parse(graph ?? defaultGraph) as PlannerGraph;
  mergedGraph.metadata = normalizeMetadata(mergedGraph.metadata as Record<string, unknown>, {
    fallbackTitle: mergedGraph.metadata.title ?? path.basename(normalized, ".planner-graph.json"),
    fallbackSummary: mergedGraph.metadata.summary ?? "Graph design artifact",
    updatedAt: new Date().toISOString(),
  });

  await atomicWriteFile(absolutePath, serializeGraphDocument(mergedGraph));
  return getEntry(workspaceRoot, normalized) as Promise<PlannerGraphEntry>;
}

export async function updateDoc(
  workspaceRoot: string,
  entryPath: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<PlannerDocEntry> {
  const normalized = ensureDocPath(entryPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  const existing = (await getEntry(workspaceRoot, normalized, true)) as PlannerDocEntry;
  const mergedMetadata = normalizeMetadata(
    {
      ...existing.metadata,
      ...(metadata ?? {}),
    },
    {
      fallbackTitle: deriveTitleFromContent(content, existing.title),
      fallbackSummary: deriveSummary(content, existing.summary),
      updatedAt: new Date().toISOString(),
    },
  );

  await atomicWriteFile(absolutePath, serializeMarkdownDocument(content, mergedMetadata));
  return getEntry(workspaceRoot, normalized, true) as Promise<PlannerDocEntry>;
}

export async function updateGraph(
  workspaceRoot: string,
  entryPath: string,
  graph: PlannerGraph,
): Promise<PlannerGraphEntry> {
  const normalized = ensureGraphPath(entryPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  const existing = (await getEntry(workspaceRoot, normalized, true)) as PlannerGraphEntry;
  const parsed = plannerGraphSchema.parse(graph) as PlannerGraph;
  parsed.metadata = normalizeMetadata(parsed.metadata as Record<string, unknown>, {
    fallbackTitle: parsed.metadata.title ?? existing.title,
    fallbackSummary:
      parsed.metadata.summary ??
      deriveSummary(parsed.nodes.map((node) => `${node.label} ${node.body ?? ""}`).join(" "), existing.summary),
    updatedAt: new Date().toISOString(),
  });

  await atomicWriteFile(absolutePath, serializeGraphDocument(parsed));
  return getEntry(workspaceRoot, normalized, true) as Promise<PlannerGraphEntry>;
}

export async function moveEntry(
  workspaceRoot: string,
  entryPath: string,
  newEntryPath: string,
): Promise<PlannerEntry> {
  const source = normalizeRelativeEntryPath(entryPath);
  const target = normalizeRelativeEntryPath(newEntryPath);
  const sourceAbsolute = resolveEntryAbsolutePath(workspaceRoot, source);
  const targetAbsolute = resolveEntryAbsolutePath(workspaceRoot, target);

  await ensureDirectory(path.dirname(targetAbsolute));
  await fs.rename(sourceAbsolute, targetAbsolute);
  return getEntry(workspaceRoot, target, true);
}

export async function duplicateEntry(
  workspaceRoot: string,
  entryPath: string,
  newEntryPath?: string,
): Promise<PlannerEntry> {
  const source = normalizeRelativeEntryPath(entryPath);
  const sourceAbsolute = resolveEntryAbsolutePath(workspaceRoot, source);
  const sourceStats = await fs.stat(sourceAbsolute);

  let target = newEntryPath ? normalizeRelativeEntryPath(newEntryPath) : source;
  if (!newEntryPath) {
    const parsed = path.parse(source);
    target = path.posix.join(parsed.dir, `${parsed.name}-copy${parsed.ext}`);
  }
  const targetAbsolute = await ensureUniquePath(resolveEntryAbsolutePath(workspaceRoot, target));

  if (sourceStats.isDirectory()) {
    await fs.cp(sourceAbsolute, targetAbsolute, { recursive: true });
  } else {
    await ensureDirectory(path.dirname(targetAbsolute));
    await fs.copyFile(sourceAbsolute, targetAbsolute);
  }

  return getEntry(workspaceRoot, toEntryPath(workspaceRoot, targetAbsolute), true);
}

export async function archiveEntry(workspaceRoot: string, entryPath: string): Promise<PlannerEntry> {
  const normalized = normalizeRelativeEntryPath(entryPath);
  if (isArchivedPath(normalized)) {
    throw new Error(`Entry is already archived: ${entryPath}`);
  }

  const sourceAbsolute = resolveEntryAbsolutePath(workspaceRoot, normalized);
  const archivePath = path.posix.join(ARCHIVE_DIR, normalized);
  const targetAbsolute = await ensureUniquePath(resolveEntryAbsolutePath(workspaceRoot, archivePath));

  await ensureDirectory(path.dirname(targetAbsolute));
  await fs.rename(sourceAbsolute, targetAbsolute);
  return getEntry(workspaceRoot, toEntryPath(workspaceRoot, targetAbsolute), true);
}

export async function restoreEntry(
  workspaceRoot: string,
  archivedEntryPath: string,
  restorePath?: string,
): Promise<PlannerEntry> {
  const normalized = normalizeRelativeEntryPath(archivedEntryPath);
  if (!isArchivedPath(normalized)) {
    throw new Error(`Entry is not archived: ${archivedEntryPath}`);
  }

  const sourceAbsolute = resolveEntryAbsolutePath(workspaceRoot, normalized);
  const destinationPath = restorePath
    ? normalizeRelativeEntryPath(restorePath)
    : stripArchivePrefix(normalized);
  const targetAbsolute = await ensureUniquePath(resolveEntryAbsolutePath(workspaceRoot, destinationPath));

  await ensureDirectory(path.dirname(targetAbsolute));
  await fs.rename(sourceAbsolute, targetAbsolute);
  return getEntry(workspaceRoot, toEntryPath(workspaceRoot, targetAbsolute), true);
}

export async function compileContext(
  workspaceRoot: string,
  options: CompileContextOptions = {},
): Promise<ProjectContextResult> {
  const entries = await readExistingEntriesInScope(workspaceRoot, options.entryPaths);
  return compileProjectContext(entries.filter((entry) => entry.kind !== "folder"));
}

export async function deleteEntryPermanently(workspaceRoot: string, entryPath: string): Promise<void> {
  const normalized = normalizeRelativeEntryPath(entryPath);
  const absolutePath = resolveEntryAbsolutePath(workspaceRoot, normalized);
  await fs.rm(absolutePath, { recursive: true, force: true });
}

export function docToPayload(entry: PlannerDocEntry): {
  kind: "doc";
  path: string;
  title: string;
  summary: string;
  metadata: PlannerMetadata;
  content: string;
  revision: string;
} {
  return {
    kind: "doc",
    path: entry.path,
    title: entry.title,
    summary: entry.summary,
    metadata: entry.metadata,
    content: entry.content,
    revision: entry.revision,
  };
}

export function graphToPayload(entry: PlannerGraphEntry): {
  kind: "graph";
  path: string;
  title: string;
  summary: string;
  metadata: PlannerMetadata;
  graph: PlannerGraph;
  revision: string;
} {
  return {
    kind: "graph",
    path: entry.path,
    title: entry.title,
    summary: entry.summary,
    metadata: entry.metadata,
    graph: entry.graph,
    revision: entry.revision,
  };
}

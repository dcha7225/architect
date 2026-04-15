import matter from "gray-matter";

import { deriveSummary, deriveTitleFromContent, normalizeMetadata } from "./metadata.js";
import type { PlannerDocEntry, PlannerMetadata } from "./types.js";

function buildRevision(mtimeMs: number, size: number): string {
  return `${Math.floor(mtimeMs)}-${size}`;
}

export function parseMarkdownDocument(
  raw: string,
  options: {
    path: string;
    archived: boolean;
    mtimeMs: number;
    size: number;
  },
): PlannerDocEntry {
  const parsed = matter(raw);
  const fallbackTitle = deriveTitleFromContent(parsed.content, options.path.split("/").pop() ?? "Untitled");
  const fallbackSummary = deriveSummary(parsed.content, "");
  const metadata = normalizeMetadata(parsed.data, {
    fallbackTitle,
    fallbackSummary,
  });

  return {
    kind: "doc",
    name: options.path.split("/").pop() ?? options.path,
    path: options.path,
    archived: options.archived,
    metadata,
    title: metadata.title ?? fallbackTitle,
    summary: metadata.summary ?? fallbackSummary,
    revision: buildRevision(options.mtimeMs, options.size),
    content: parsed.content,
  };
}

export function serializeMarkdownDocument(content: string, metadata: PlannerMetadata): string {
  return matter.stringify(content, metadata);
}

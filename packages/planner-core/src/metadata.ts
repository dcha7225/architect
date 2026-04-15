import type { JsonValue, PlannerMetadata } from "./types.js";

function normalizeTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function deriveTitleFromContent(content: string, fallback: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));

  if (heading) {
    return heading.replace(/^#+\s*/, "").trim() || fallback;
  }

  const paragraph = content
    .split(/\r?\n\r?\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .find(Boolean);

  return paragraph ? paragraph.slice(0, 80) : fallback;
}

export function deriveSummary(content: string, fallback = ""): string {
  const paragraph = content
    .split(/\r?\n\r?\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .find(Boolean);

  if (!paragraph) {
    return fallback;
  }

  return paragraph.length > 180 ? `${paragraph.slice(0, 177)}...` : paragraph;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}

export function normalizeMetadata(
  rawMetadata: Record<string, unknown> | undefined,
  options: {
    fallbackTitle: string;
    fallbackSummary?: string;
    updatedAt?: string;
  },
): PlannerMetadata {
  const normalized: PlannerMetadata = {};

  for (const [key, value] of Object.entries(rawMetadata ?? {})) {
    if (value === undefined || !isJsonValue(value)) {
      continue;
    }

    normalized[key] = value;
  }

  normalized.title =
    typeof rawMetadata?.title === "string" && rawMetadata.title.trim()
      ? rawMetadata.title.trim()
      : options.fallbackTitle;

  const tags = normalizeTags(rawMetadata?.tags);
  if (tags) {
    normalized.tags = tags;
  }

  const summary =
    typeof rawMetadata?.summary === "string" && rawMetadata.summary.trim()
      ? rawMetadata.summary.trim()
      : options.fallbackSummary;
  if (summary) {
    normalized.summary = summary;
  }

  if (options.updatedAt) {
    normalized.updatedAt = options.updatedAt;
  } else if (typeof rawMetadata?.updatedAt === "string") {
    normalized.updatedAt = rawMetadata.updatedAt;
  }

  return normalized;
}

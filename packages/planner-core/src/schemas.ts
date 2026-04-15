import { z } from "zod";

const jsonLiteral = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const jsonSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([jsonLiteral, z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);
export type JsonSchemaValue = z.infer<typeof jsonSchema>;

export const metadataSchema = z
  .record(z.string(), jsonSchema.optional())
  .and(
    z.object({
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
      summary: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
  );

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  body: z.string().optional(),
  color: z.string().optional(),
  metadata: z.record(z.string(), jsonSchema.optional()).optional(),
  annotations: z.record(z.string(), jsonSchema.optional()).optional(),
  links: z.array(z.string()).optional(),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  metadata: z.record(z.string(), jsonSchema.optional()).optional(),
  annotations: z.record(z.string(), jsonSchema.optional()).optional(),
});

export const graphGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  memberIds: z.array(z.string()),
  color: z.string().optional(),
  metadata: z.record(z.string(), jsonSchema.optional()).optional(),
  annotations: z.record(z.string(), jsonSchema.optional()).optional(),
});

export const graphCommentSchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1),
  x: z.number(),
  y: z.number(),
  color: z.string().optional(),
  metadata: z.record(z.string(), jsonSchema.optional()).optional(),
});

export const plannerGraphSchema = z.object({
  version: z.number().int().positive().default(1),
  metadata: metadataSchema.default({}),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .optional(),
  nodes: z.array(graphNodeSchema).default([]),
  edges: z.array(graphEdgeSchema).default([]),
  groups: z.array(graphGroupSchema).default([]),
  comments: z.array(graphCommentSchema).optional(),
});

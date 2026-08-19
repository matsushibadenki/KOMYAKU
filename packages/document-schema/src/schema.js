import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

export const DOCUMENT_SCHEMA_ID = "https://komyaku.example/schemas/document/v1";
export const DOCUMENT_SCHEMA_VERSION = 1;
export const DEFAULT_DOCUMENT_LIMITS = Object.freeze({
  maxNodes: 100_000,
  maxDepth: 64,
  maxJsonValues: 500_000,
  maxStringCodeUnits: 10 * 1024 * 1024
});

const uuidSchema = z.string().uuid();
const languageSchema = z.string().min(1).max(100)
  .regex(/^(?:und|[A-Za-z0-9][A-Za-z0-9-]{0,99})$/);
const directionSchema = z.enum(["auto", "ltr", "rtl"]);
const writingModeSchema = z.enum(["horizontal-tb", "vertical-rl", "vertical-lr"]);
const jsonValueSchema = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema),
  z.record(z.string().max(200), jsonValueSchema)
]));

export const metadataSchema = z.record(z.string().max(200), jsonValueSchema);
const extensionsSchema = z.record(
  z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  jsonValueSchema
);
const renderArtifactSchema = z.object({
  assetId: uuidSchema,
  role: z.enum(["preview", "thumbnail", "generated-pdf", "render-cache"]),
  mediaType: z.string().min(1).max(200),
  renderer: z.string().min(1).max(200).optional(),
  rendererVersion: z.string().min(1).max(100).optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();
const provenanceSchema = z.object({
  createdAt: z.string().datetime({ offset: true }).optional(),
  createdBy: uuidSchema.optional(),
  sourceNodeId: uuidSchema.optional(),
  sourceVersionId: uuidSchema.optional()
}).strict();
const commonNodeFields = {
  id: uuidSchema,
  schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
  metadata: metadataSchema.default({}),
  extensions: extensionsSchema.default({}),
  renderArtifacts: z.array(renderArtifactSchema).max(20).default([]),
  provenance: provenanceSchema.optional()
};

function safeLink(value) {
  if (value.startsWith("#") || value.startsWith("./") || value.startsWith("../")) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return true;
  try { return new Set(["http:", "https:", "mailto:"]).has(new URL(value).protocol); }
  catch { return false; }
}

export const markSchema = z.discriminatedUnion("type", [
  ...["bold", "italic", "underline", "strike", "code"].map((type) =>
    z.object({ type: z.literal(type) }).strict()),
  z.object({
    type: z.literal("link"),
    href: z.string().min(1).max(2048).refine(safeLink, "Unsupported or unsafe link scheme"),
    title: z.string().max(1000).nullable().optional()
  }).strict()
]);

const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(markSchema).max(20).default([]),
  metadata: metadataSchema.default({}),
  extensions: extensionsSchema.default({})
}).strict().superRefine((node, context) => {
  const keys = node.marks.map((mark) => mark.type === "link" ? `${mark.type}:${mark.href}` : mark.type);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["marks"], message: "Text marks must be unique" });
  }
});
const hardBreakNodeSchema = z.object({ type: z.literal("hard_break") }).strict();
const mathInlineNodeSchema = z.object({
  ...commonNodeFields,
  type: z.literal("math_inline"),
  sourceType: z.literal("latex").default("latex"),
  source: z.string()
}).strict();
export const inlineNodeSchema = z.union([textNodeSchema, hardBreakNodeSchema, mathInlineNodeSchema]);

const languageAttributes = {
  lang: languageSchema.nullable().default(null),
  dir: directionSchema.default("auto")
};
let blockNodeSchemaInternal;
const nestedBlocks = () => z.array(z.lazy(() => blockNodeSchemaInternal)).min(1);
const paragraphSchema = z.object({
  ...commonNodeFields, type: z.literal("paragraph"),
  attrs: z.object(languageAttributes).strict().default({}),
  content: z.array(inlineNodeSchema).default([])
}).strict();
const headingSchema = z.object({
  ...commonNodeFields, type: z.literal("heading"),
  attrs: z.object({ level: z.number().int().min(1).max(6).default(1), ...languageAttributes }).strict(),
  content: z.array(inlineNodeSchema).default([])
}).strict();
const blockquoteSchema = z.object({
  ...commonNodeFields, type: z.literal("blockquote"), content: nestedBlocks()
}).strict();
const listItemSchema = z.object({
  ...commonNodeFields, type: z.literal("list_item"), content: nestedBlocks()
}).strict();
const bulletListSchema = z.object({
  ...commonNodeFields, type: z.literal("bullet_list"), content: z.array(listItemSchema).min(1)
}).strict();
const orderedListSchema = z.object({
  ...commonNodeFields, type: z.literal("ordered_list"),
  attrs: z.object({ start: z.number().int().min(1).max(1_000_000).default(1) }).strict(),
  content: z.array(listItemSchema).min(1)
}).strict();
const codeBlockSchema = z.object({
  ...commonNodeFields, type: z.literal("code_block"),
  language: z.string().min(1).max(100).nullable().default(null), source: z.string()
}).strict();
const mathBlockSchema = z.object({
  ...commonNodeFields, type: z.literal("math_block"), sourceType: z.literal("latex").default("latex"),
  source: z.string(), displayMode: z.literal("block").default("block")
}).strict();
const diagramSchema = z.object({
  ...commonNodeFields, type: z.literal("diagram"), sourceType: z.enum(["mermaid", "svg"]),
  source: z.string(), altText: z.string().max(10_000).default(""),
  caption: z.array(inlineNodeSchema).default([])
}).strict();
const imageSchema = z.object({
  ...commonNodeFields, type: z.literal("image"), assetId: uuidSchema,
  mediaType: z.string().regex(/^image\/[A-Za-z0-9.+-]+$/),
  altText: z.string().max(10_000).default(""), caption: z.array(inlineNodeSchema).default([]),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null)
}).strict();
const fileSchema = z.object({
  ...commonNodeFields, type: z.literal("file"), assetId: uuidSchema,
  mediaType: z.string().min(1).max(200), fileName: z.string().min(1).max(1000),
  title: z.string().max(1000).nullable().default(null),
  description: z.string().max(10_000).nullable().default(null)
}).strict();
const tableCellSchema = z.object({
  ...commonNodeFields, type: z.literal("table_cell"),
  attrs: z.object({
    header: z.boolean().default(false),
    colspan: z.number().int().min(1).max(100).default(1),
    rowspan: z.number().int().min(1).max(100).default(1)
  }).strict(),
  content: nestedBlocks()
}).strict();
const tableRowSchema = z.object({
  ...commonNodeFields, type: z.literal("table_row"), content: z.array(tableCellSchema).min(1)
}).strict();
const tableSchema = z.object({
  ...commonNodeFields, type: z.literal("table"), content: z.array(tableRowSchema).min(1)
}).strict();
const horizontalRuleSchema = z.object({
  ...commonNodeFields, type: z.literal("horizontal_rule")
}).strict();

blockNodeSchemaInternal = z.union([
  paragraphSchema, headingSchema, blockquoteSchema, bulletListSchema, orderedListSchema,
  listItemSchema, codeBlockSchema, mathBlockSchema, diagramSchema, imageSchema, fileSchema,
  tableSchema, tableRowSchema, tableCellSchema, horizontalRuleSchema
]);
export const blockNodeSchema = blockNodeSchemaInternal;

export const canonicalDocumentSchema = z.object({
  schemaId: z.literal(DOCUMENT_SCHEMA_ID),
  schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
  id: uuidSchema,
  type: z.literal("document"),
  attrs: z.object({
    language: languageSchema.default("und"), direction: directionSchema.default("auto"),
    writingMode: writingModeSchema.default("horizontal-tb")
  }).strict(),
  metadata: metadataSchema.default({}), extensions: extensionsSchema.default({}),
  content: z.array(blockNodeSchema).min(1)
}).strict();

export class DocumentSchemaError extends Error {
  constructor(code, message = code) { super(message); this.name = "DocumentSchemaError"; this.code = code; }
}

function preflightJson(input, limits) {
  const stack = [{ value: input, depth: 0 }];
  const seen = new WeakSet();
  let values = 0;
  let stringCodeUnits = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (++values > limits.maxJsonValues) throw new DocumentSchemaError("document_too_complex");
    if (typeof value === "string") {
      stringCodeUnits += value.length;
      if (stringCodeUnits > limits.maxStringCodeUnits) throw new DocumentSchemaError("document_too_large");
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (depth > Math.max(limits.maxDepth + 8, 32)) throw new DocumentSchemaError("document_too_deep");
    if (seen.has(value)) throw new DocumentSchemaError("document_contains_cycle");
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
}

function childNodes(node) {
  return node.content ?? node.caption ?? [];
}

function assertDocumentInvariants(document, limits) {
  const ids = new Set([document.id]);
  const stack = document.content.map((node) => ({ node, depth: 1, parentType: "document" }));
  let nodeCount = 0;
  while (stack.length > 0) {
    const { node, depth, parentType } = stack.pop();
    if (++nodeCount > limits.maxNodes) throw new DocumentSchemaError("document_has_too_many_nodes");
    if (depth > limits.maxDepth) throw new DocumentSchemaError("document_too_deep");
    if (node.id) {
      if (ids.has(node.id)) throw new DocumentSchemaError("duplicate_node_id", `Duplicate Node ID: ${node.id}`);
      ids.add(node.id);
    }
    const requiredParent = {
      list_item: new Set(["bullet_list", "ordered_list"]),
      table_row: new Set(["table"]),
      table_cell: new Set(["table_row"])
    }[node.type];
    if (requiredParent && !requiredParent.has(parentType)) {
      throw new DocumentSchemaError("invalid_node_parent", `${node.type} cannot be a child of ${parentType}`);
    }
    for (const child of childNodes(node)) {
      if (child && typeof child === "object") {
        stack.push({ node: child, depth: depth + 1, parentType: node.type });
      }
    }
  }
  return document;
}

export function parseCanonicalDocument(input, { limits = DEFAULT_DOCUMENT_LIMITS } = {}) {
  const effectiveLimits = { ...DEFAULT_DOCUMENT_LIMITS, ...limits };
  preflightJson(input, effectiveLimits);
  return assertDocumentInvariants(canonicalDocumentSchema.parse(input), effectiveLimits);
}
export function safeParseCanonicalDocument(input, options) {
  try { return { success: true, data: parseCanonicalDocument(input, options) }; }
  catch (error) { return { success: false, error }; }
}
export function createNodeId() { return uuidv7(); }
export function createCanonicalNode(type, value = {}, { idFactory = createNodeId } = {}) {
  return blockNodeSchema.parse({
    id: idFactory(), schemaVersion: DOCUMENT_SCHEMA_VERSION, metadata: {}, extensions: {},
    renderArtifacts: [], type, ...value
  });
}
export function createEmptyDocument({
  id = createNodeId(), language = "und", direction = "auto", writingMode = "horizontal-tb",
  nodeIdFactory = createNodeId, metadata = {}, extensions = {}
} = {}) {
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID, schemaVersion: DOCUMENT_SCHEMA_VERSION, id, type: "document",
    attrs: { language, direction, writingMode }, metadata, extensions,
    content: [createCanonicalNode("paragraph", { attrs: {}, content: [] }, { idFactory: nodeIdFactory })]
  });
}
export function serializeCanonicalDocument(input) { return JSON.stringify(parseCanonicalDocument(input)); }
export function collectNodeIds(input) {
  const document = parseCanonicalDocument(input);
  const ids = [document.id];
  const stack = [...document.content];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.id) ids.push(node.id);
    for (const child of childNodes(node)) if (child && typeof child === "object") stack.push(child);
  }
  return ids;
}
export function collectAssetIds(input) {
  const document = parseCanonicalDocument(input);
  const ids = new Set();
  const stack = [...document.content];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.assetId) ids.add(node.assetId);
    for (const artifact of node.renderArtifacts ?? []) ids.add(artifact.assetId);
    for (const child of childNodes(node)) if (child && typeof child === "object") stack.push(child);
  }
  return [...ids];
}

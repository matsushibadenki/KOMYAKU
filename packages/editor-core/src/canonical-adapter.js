import {
  DOCUMENT_SCHEMA_ID,
  DOCUMENT_SCHEMA_VERSION,
  createNodeId,
  parseCanonicalDocument
} from "@komyaku/document-schema";
import { komyakuSchema } from "./prosemirror-schema.js";

export class EditorConversionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "EditorConversionError";
    this.code = code;
  }
}

function identityToEditor(node) {
  return {
    nodeId: node.id,
    schemaVersion: node.schemaVersion,
    metadata: node.metadata,
    extensions: node.extensions,
    renderArtifacts: node.renderArtifacts,
    provenance: node.provenance ?? null
  };
}

function marksToEditor(marks) {
  return marks.map((mark) => mark.type === "link"
    ? { type: "link", attrs: { href: mark.href, title: mark.title ?? null } }
    : { type: mark.type });
}

function inlineToEditor(node) {
  if (node.type === "text") {
    if (Object.keys(node.metadata).length > 0 || Object.keys(node.extensions).length > 0) {
      throw new EditorConversionError("text_metadata_not_supported_by_editor");
    }
    return { type: "text", text: node.text, marks: marksToEditor(node.marks) };
  }
  if (node.type === "hard_break") return { type: "hard_break" };
  return { type: "math_inline", attrs: { ...identityToEditor(node), sourceType: node.sourceType, source: node.source } };
}

function blockToEditor(node) {
  const identity = identityToEditor(node);
  const content = () => node.content.map(blockToEditor);
  const inlines = () => node.content.map(inlineToEditor);
  switch (node.type) {
    case "paragraph": return { type: "paragraph", attrs: { ...identity, ...node.attrs }, content: inlines() };
    case "heading": return { type: "heading", attrs: { ...identity, ...node.attrs }, content: inlines() };
    case "blockquote":
    case "bullet_list":
    case "list_item":
    case "table":
    case "table_row": return { type: node.type, attrs: identity, content: content() };
    case "ordered_list": return { type: node.type, attrs: { ...identity, start: node.attrs.start }, content: content() };
    case "table_cell": return { type: node.type, attrs: { ...identity, ...node.attrs }, content: content() };
    case "code_block": return {
      type: node.type, attrs: { ...identity, language: node.language },
      content: node.source.length > 0 ? [{ type: "text", text: node.source }] : undefined
    };
    case "math_block": return { type: node.type, attrs: { ...identity, sourceType: node.sourceType, source: node.source, displayMode: node.displayMode } };
    case "diagram": return { type: node.type, attrs: { ...identity, sourceType: node.sourceType, source: node.source, altText: node.altText, caption: node.caption } };
    case "image": return { type: node.type, attrs: { ...identity, assetId: node.assetId, mediaType: node.mediaType, altText: node.altText, caption: node.caption, width: node.width, height: node.height } };
    case "file": return { type: node.type, attrs: { ...identity, assetId: node.assetId, mediaType: node.mediaType, fileName: node.fileName, title: node.title, description: node.description } };
    case "horizontal_rule": return { type: node.type, attrs: identity };
    default: throw new EditorConversionError("unsupported_canonical_node", `Unsupported canonical node: ${node.type}`);
  }
}

export function canonicalToEditorDocument(input) {
  const document = parseCanonicalDocument(input);
  return komyakuSchema.nodeFromJSON({
    type: "doc",
    attrs: {
      documentId: document.id,
      schemaVersion: document.schemaVersion,
      language: document.attrs.language,
      direction: document.attrs.direction,
      writingMode: document.attrs.writingMode,
      metadata: document.metadata,
      extensions: document.extensions
    },
    content: document.content.map(blockToEditor)
  });
}

function identityFromEditor(node, idFactory) {
  return {
    id: node.attrs?.nodeId ?? idFactory(),
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: node.attrs?.metadata ?? {},
    extensions: node.attrs?.extensions ?? {},
    renderArtifacts: node.attrs?.renderArtifacts ?? [],
    ...(node.attrs?.provenance ? { provenance: node.attrs.provenance } : {})
  };
}

function marksFromEditor(marks = []) {
  return marks.map((mark) => mark.type === "link"
    ? { type: "link", href: mark.attrs?.href, title: mark.attrs?.title ?? null }
    : { type: mark.type });
}

function inlineFromEditor(node, idFactory) {
  if (node.type === "text") {
    if (Object.keys(node.attrs?.metadata ?? {}).length > 0 || Object.keys(node.attrs?.extensions ?? {}).length > 0) {
      throw new EditorConversionError("text_metadata_not_supported_by_editor");
    }
    return { type: "text", text: node.text ?? "", marks: marksFromEditor(node.marks), metadata: {}, extensions: {} };
  }
  if (node.type === "hard_break") return { type: "hard_break" };
  if (node.type === "math_inline") {
    return { ...identityFromEditor(node, idFactory), type: node.type, sourceType: node.attrs?.sourceType ?? "latex", source: node.attrs?.source ?? "" };
  }
  throw new EditorConversionError("unsupported_editor_inline_node", `Unsupported editor inline node: ${node.type}`);
}

function blockFromEditor(node, idFactory) {
  const identity = identityFromEditor(node, idFactory);
  const content = () => (node.content ?? []).map((child) => blockFromEditor(child, idFactory));
  const inlines = () => (node.content ?? []).map((child) => inlineFromEditor(child, idFactory));
  switch (node.type) {
    case "paragraph": return { ...identity, type: node.type, attrs: { lang: node.attrs?.lang ?? null, dir: node.attrs?.dir ?? "auto" }, content: inlines() };
    case "heading": return { ...identity, type: node.type, attrs: { level: node.attrs?.level ?? 1, lang: node.attrs?.lang ?? null, dir: node.attrs?.dir ?? "auto" }, content: inlines() };
    case "blockquote":
    case "bullet_list":
    case "list_item":
    case "table":
    case "table_row": return { ...identity, type: node.type, content: content() };
    case "ordered_list": return { ...identity, type: node.type, attrs: { start: node.attrs?.start ?? 1 }, content: content() };
    case "table_cell": return { ...identity, type: node.type, attrs: { header: node.attrs?.header ?? false, colspan: node.attrs?.colspan ?? 1, rowspan: node.attrs?.rowspan ?? 1 }, content: content() };
    case "code_block": return { ...identity, type: node.type, language: node.attrs?.language ?? null, source: (node.content ?? []).map((child) => child.text ?? "").join("") };
    case "math_block": return { ...identity, type: node.type, sourceType: node.attrs?.sourceType ?? "latex", source: node.attrs?.source ?? "", displayMode: "block" };
    case "diagram": return { ...identity, type: node.type, sourceType: node.attrs?.sourceType ?? "mermaid", source: node.attrs?.source ?? "", altText: node.attrs?.altText ?? "", caption: node.attrs?.caption ?? [] };
    case "image": return { ...identity, type: node.type, assetId: node.attrs?.assetId, mediaType: node.attrs?.mediaType, altText: node.attrs?.altText ?? "", caption: node.attrs?.caption ?? [], width: node.attrs?.width ?? null, height: node.attrs?.height ?? null };
    case "file": return { ...identity, type: node.type, assetId: node.attrs?.assetId, mediaType: node.attrs?.mediaType, fileName: node.attrs?.fileName, title: node.attrs?.title ?? null, description: node.attrs?.description ?? null };
    case "horizontal_rule": return { ...identity, type: node.type };
    default: throw new EditorConversionError("unsupported_editor_block_node", `Unsupported editor block node: ${node.type}`);
  }
}

export function editorToCanonicalDocument(editorDocument, { idFactory = createNodeId } = {}) {
  const json = typeof editorDocument?.toJSON === "function" ? editorDocument.toJSON() : editorDocument;
  if (!json || json.type !== "doc" || !Array.isArray(json.content)) {
    throw new EditorConversionError("invalid_editor_document");
  }
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: json.attrs?.documentId ?? idFactory(),
    type: "document",
    attrs: {
      language: json.attrs?.language ?? "und",
      direction: json.attrs?.direction ?? "auto",
      writingMode: json.attrs?.writingMode ?? "horizontal-tb"
    },
    metadata: json.attrs?.metadata ?? {},
    extensions: json.attrs?.extensions ?? {},
    content: json.content.map((node) => blockFromEditor(node, idFactory))
  });
}

import {
  DOCUMENT_SCHEMA_ID,
  DOCUMENT_SCHEMA_VERSION,
  DocumentSchemaError,
  createNodeId,
  parseCanonicalDocument,
  safeParseCanonicalDocument
} from "./schema.js";

function legacyMarks(marks = []) {
  return marks.map((mark) => mark.type === "link"
    ? { type: "link", href: mark.attrs?.href, title: mark.attrs?.title ?? null }
    : { type: mark.type });
}

export function migrateLegacyEditorDocument(input, { idFactory = createNodeId } = {}) {
  if (!input || !["doc", "document"].includes(input.type) || !Array.isArray(input.content)) {
    throw new DocumentSchemaError("unsupported_legacy_document");
  }
  function common(node) {
    return {
      id: idFactory(), schemaVersion: DOCUMENT_SCHEMA_VERSION,
      metadata: node.attrs?.metadata ?? {}, extensions: {}, renderArtifacts: []
    };
  }
  function inline(node) {
    if (node.type === "text") {
      return { type: "text", text: node.text ?? "", marks: legacyMarks(node.marks), metadata: {}, extensions: {} };
    }
    if (node.type === "hard_break") return { type: "hard_break" };
    if (node.type === "math_inline") {
      return { ...common(node), type: "math_inline", sourceType: "latex", source: node.attrs?.source ?? "" };
    }
    throw new DocumentSchemaError("unsupported_legacy_node", `Unsupported legacy inline node: ${node.type}`);
  }
  function block(node) {
    const base = common(node);
    const children = () => (node.content ?? []).map(block);
    const inlines = () => (node.content ?? []).map(inline);
    switch (node.type) {
      case "paragraph": return { ...base, type: "paragraph", attrs: {
        lang: node.attrs?.lang ?? null, dir: node.attrs?.dir ?? "auto"
      }, content: inlines() };
      case "heading": return { ...base, type: "heading", attrs: {
        level: node.attrs?.level ?? 1, lang: node.attrs?.lang ?? null, dir: node.attrs?.dir ?? "auto"
      }, content: inlines() };
      case "blockquote": return { ...base, type: "blockquote", content: children() };
      case "bullet_list": return { ...base, type: "bullet_list", content: children() };
      case "ordered_list": return { ...base, type: "ordered_list", attrs: {
        start: node.attrs?.order ?? node.attrs?.start ?? 1
      }, content: children() };
      case "list_item": return { ...base, type: "list_item", content: children() };
      case "code_block": return { ...base, type: "code_block", language: node.attrs?.language ?? null,
        source: (node.content ?? []).map((child) => child.text ?? "").join("") };
      case "math_block": return { ...base, type: "math_block", sourceType: "latex",
        source: node.attrs?.source ?? "", displayMode: "block" };
      case "mermaid_block": return { ...base, type: "diagram", sourceType: "mermaid",
        source: node.attrs?.source ?? "", altText: "", caption: [] };
      case "attachment": return { ...base, type: "file", assetId: node.attrs?.assetId,
        mediaType: node.attrs?.mediaType, fileName: node.attrs?.title ?? "attachment",
        title: node.attrs?.title ?? null, description: null };
      case "horizontal_rule": return { ...base, type: "horizontal_rule" };
      default: throw new DocumentSchemaError("unsupported_legacy_node", `Unsupported legacy block node: ${node.type}`);
    }
  }
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID, schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: input.id ?? idFactory(), type: "document",
    attrs: {
      language: input.attrs?.language ?? "und", direction: input.attrs?.direction ?? "auto",
      writingMode: input.attrs?.writingMode ?? "horizontal-tb"
    },
    metadata: input.metadata ?? {}, extensions: input.extensions ?? {},
    content: input.content.map(block)
  });
}

export function migrateCanonicalDocument(input, options) {
  const parsed = safeParseCanonicalDocument(input);
  if (parsed.success) return parsed.data;
  if (input?.schemaVersion > DOCUMENT_SCHEMA_VERSION || input?.schemaId) {
    throw new DocumentSchemaError("unsupported_document_schema_version");
  }
  return migrateLegacyEditorDocument(input, options);
}

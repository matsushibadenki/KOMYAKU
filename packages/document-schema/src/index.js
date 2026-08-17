export const DOCUMENT_SCHEMA_VERSION = 1;

export function createEmptyDocument({ language = "und", direction = "auto" } = {}) {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    type: "document",
    attrs: { language, direction, writingMode: "horizontal-tb" },
    content: [{ type: "paragraph", content: [] }]
  };
}


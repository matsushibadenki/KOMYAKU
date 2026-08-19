import { DOCUMENT_SCHEMA_VERSION, createNodeId } from "@komyaku/document-schema";
import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";

const identityAttrs = {
  nodeId: { default: null },
  schemaVersion: { default: DOCUMENT_SCHEMA_VERSION },
  metadata: { default: {} },
  extensions: { default: {} },
  renderArtifacts: { default: [] },
  provenance: { default: null }
};

const languageAttrs = {
  lang: { default: null },
  dir: { default: "auto" }
};

export const komyakuSchema = new Schema({
  nodes: {
    doc: {
      content: "block+",
      attrs: {
        documentId: { default: null },
        schemaVersion: { default: DOCUMENT_SCHEMA_VERSION },
        language: { default: "und" },
        direction: { default: "auto" },
        writingMode: { default: "horizontal-tb" },
        metadata: { default: {} },
        extensions: { default: {} }
      }
    },
    paragraph: { content: "inline*", group: "block", attrs: { ...identityAttrs, ...languageAttrs } },
    heading: {
      content: "inline*", group: "block", defining: true,
      attrs: { ...identityAttrs, level: { default: 1 }, ...languageAttrs }
    },
    blockquote: { content: "block+", group: "block", defining: true, attrs: identityAttrs },
    ordered_list: {
      content: "list_item+", group: "block",
      attrs: { ...identityAttrs, start: { default: 1 } }
    },
    bullet_list: { content: "list_item+", group: "block", attrs: identityAttrs },
    list_item: { content: "block+", defining: true, attrs: identityAttrs },
    code_block: {
      content: "text*", marks: "", group: "block", code: true, defining: true,
      attrs: { ...identityAttrs, language: { default: null } }
    },
    math_block: {
      group: "block", atom: true,
      attrs: { ...identityAttrs, sourceType: { default: "latex" }, source: { default: "" }, displayMode: { default: "block" } }
    },
    diagram: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, sourceType: { default: "mermaid" }, source: { default: "" },
        altText: { default: "" }, caption: { default: [] }
      }
    },
    image: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, assetId: {}, mediaType: {}, altText: { default: "" },
        caption: { default: [] }, width: { default: null }, height: { default: null }
      }
    },
    file: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, assetId: {}, mediaType: {}, fileName: {},
        title: { default: null }, description: { default: null }
      }
    },
    table: { content: "table_row+", group: "block", attrs: identityAttrs },
    table_row: { content: "table_cell+", attrs: identityAttrs },
    table_cell: {
      content: "block+",
      attrs: {
        ...identityAttrs, header: { default: false }, colspan: { default: 1 }, rowspan: { default: 1 }
      }
    },
    horizontal_rule: { group: "block", attrs: identityAttrs },
    text: { group: "inline" },
    math_inline: {
      inline: true, group: "inline", atom: true,
      attrs: { ...identityAttrs, sourceType: { default: "latex" }, source: { default: "" } }
    },
    hard_break: { inline: true, group: "inline", selectable: false }
  },
  marks: {
    bold: {}, italic: {}, underline: {}, strike: {}, code: { excludes: "_" },
    link: { inclusive: false, attrs: { href: {}, title: { default: null } } }
  }
});

export function createEmptyEditorDocument({
  documentId = createNodeId(), language = "und", direction = "auto",
  writingMode = "horizontal-tb", nodeIdFactory = createNodeId,
  metadata = {}, extensions = {}
} = {}) {
  return komyakuSchema.node("doc", {
    documentId, schemaVersion: DOCUMENT_SCHEMA_VERSION, language, direction,
    writingMode, metadata, extensions
  }, [komyakuSchema.node("paragraph", { nodeId: nodeIdFactory() })]);
}

export function createEditorState({ document = createEmptyEditorDocument() } = {}) {
  return EditorState.create({ doc: document, plugins: [history(), keymap(baseKeymap)] });
}

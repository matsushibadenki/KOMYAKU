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

function identityDomAttrs(node, extra = {}) {
  return {
    ...(node.attrs.nodeId ? { "data-node-id": node.attrs.nodeId } : {}),
    ...extra
  };
}

function parsedIdentity(dom, extra = {}) {
  return { nodeId: dom.getAttribute("data-node-id"), ...extra };
}

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
    paragraph: {
      content: "inline*", group: "block", attrs: { ...identityAttrs, ...languageAttrs },
      parseDOM: [{ tag: "p", getAttrs: (dom) => parsedIdentity(dom, { lang: dom.lang || null, dir: dom.dir || "auto" }) }],
      toDOM: (node) => ["p", identityDomAttrs(node, { lang: node.attrs.lang, dir: node.attrs.dir }), 0]
    },
    heading: {
      content: "inline*", group: "block", defining: true,
      attrs: { ...identityAttrs, level: { default: 1 }, ...languageAttrs },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        getAttrs: (dom) => parsedIdentity(dom, { level, lang: dom.lang || null, dir: dom.dir || "auto" })
      })),
      toDOM: (node) => [`h${node.attrs.level}`, identityDomAttrs(node, { lang: node.attrs.lang, dir: node.attrs.dir }), 0]
    },
    blockquote: {
      content: "block+", group: "block", defining: true, attrs: identityAttrs,
      parseDOM: [{ tag: "blockquote", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["blockquote", identityDomAttrs(node), 0]
    },
    ordered_list: {
      content: "list_item+", group: "block",
      attrs: { ...identityAttrs, start: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (dom) => parsedIdentity(dom, { start: Number(dom.getAttribute("start") ?? 1) }) }],
      toDOM: (node) => ["ol", identityDomAttrs(node, { start: node.attrs.start }), 0]
    },
    bullet_list: {
      content: "list_item+", group: "block", attrs: identityAttrs,
      parseDOM: [{ tag: "ul", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["ul", identityDomAttrs(node), 0]
    },
    list_item: {
      content: "block+", defining: true, attrs: identityAttrs,
      parseDOM: [{ tag: "li", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["li", identityDomAttrs(node), 0]
    },
    code_block: {
      content: "text*", marks: "", group: "block", code: true, defining: true,
      attrs: { ...identityAttrs, language: { default: null } },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: (dom) => parsedIdentity(dom, { language: dom.getAttribute("data-language") }) }],
      toDOM: (node) => ["pre", identityDomAttrs(node, { "data-language": node.attrs.language }), ["code", 0]]
    },
    math_block: {
      group: "block", atom: true,
      attrs: { ...identityAttrs, sourceType: { default: "latex" }, source: { default: "" }, displayMode: { default: "block" } },
      toDOM: (node) => ["div", identityDomAttrs(node, {
        class: "komyaku-source-node", "data-node-type": "math", "data-source-type": node.attrs.sourceType,
        "aria-label": `LaTeX: ${node.attrs.source}`
      }), ["code", node.attrs.source]]
    },
    diagram: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, sourceType: { default: "mermaid" }, source: { default: "" },
        altText: { default: "" }, caption: { default: [] }
      },
      toDOM: (node) => ["figure", identityDomAttrs(node, {
        class: "komyaku-source-node", "data-node-type": "diagram", "data-source-type": node.attrs.sourceType
      }), ["pre", node.attrs.source], ...(node.attrs.altText ? [["figcaption", node.attrs.altText]] : [])]
    },
    image: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, assetId: {}, mediaType: {}, altText: { default: "" },
        caption: { default: [] }, width: { default: null }, height: { default: null }
      },
      toDOM: (node) => ["figure", identityDomAttrs(node, {
        class: "komyaku-asset-node", "data-node-type": "image", role: "img", "aria-label": node.attrs.altText || "Image"
      }), ["span", `${node.attrs.mediaType} · ${node.attrs.assetId}`]]
    },
    file: {
      group: "block", atom: true,
      attrs: {
        ...identityAttrs, assetId: {}, mediaType: {}, fileName: {},
        title: { default: null }, description: { default: null }
      },
      toDOM: (node) => ["div", identityDomAttrs(node, {
        class: "komyaku-file-node", "data-node-type": "file"
      }), ["span", node.attrs.fileName]]
    },
    table: {
      content: "table_row+", group: "block", attrs: identityAttrs,
      parseDOM: [{ tag: "table", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["table", identityDomAttrs(node), ["tbody", 0]]
    },
    table_row: {
      content: "table_cell+", attrs: identityAttrs,
      parseDOM: [{ tag: "tr", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["tr", identityDomAttrs(node), 0]
    },
    table_cell: {
      content: "block+",
      attrs: {
        ...identityAttrs, header: { default: false }, colspan: { default: 1 }, rowspan: { default: 1 }
      },
      parseDOM: [{ tag: "td", getAttrs: (dom) => parsedIdentity(dom, {
        header: false, colspan: Number(dom.getAttribute("colspan") ?? 1), rowspan: Number(dom.getAttribute("rowspan") ?? 1)
      }) }, { tag: "th", getAttrs: (dom) => parsedIdentity(dom, {
        header: true, colspan: Number(dom.getAttribute("colspan") ?? 1), rowspan: Number(dom.getAttribute("rowspan") ?? 1)
      }) }],
      toDOM: (node) => [node.attrs.header ? "th" : "td", identityDomAttrs(node, {
        colspan: node.attrs.colspan, rowspan: node.attrs.rowspan
      }), 0]
    },
    horizontal_rule: {
      group: "block", attrs: identityAttrs,
      parseDOM: [{ tag: "hr", getAttrs: (dom) => parsedIdentity(dom) }],
      toDOM: (node) => ["hr", identityDomAttrs(node)]
    },
    text: { group: "inline" },
    math_inline: {
      inline: true, group: "inline", atom: true,
      attrs: { ...identityAttrs, sourceType: { default: "latex" }, source: { default: "" } },
      toDOM: (node) => ["code", identityDomAttrs(node, {
        class: "komyaku-inline-math", "data-source-type": node.attrs.sourceType,
        "aria-label": `LaTeX: ${node.attrs.source}`
      }), node.attrs.source]
    },
    hard_break: {
      inline: true, group: "inline", selectable: false,
      parseDOM: [{ tag: "br" }], toDOM: () => ["br"]
    }
  },
  marks: {
    bold: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    italic: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] },
    code: { excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      inclusive: false, attrs: { href: {}, title: { default: null } },
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href"), title: dom.getAttribute("title") }) }],
      toDOM: (mark) => ["a", { href: mark.attrs.href, title: mark.attrs.title, rel: "noopener noreferrer" }, 0]
    }
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

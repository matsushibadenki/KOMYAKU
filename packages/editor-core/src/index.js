import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";

const languageAttrs = {
  lang: { default: null },
  dir: { default: "auto" }
};

export const komyakuSchema = new Schema({
  nodes: {
    doc: {
      content: "block+",
      attrs: {
        language: { default: "und" },
        direction: { default: "auto" },
        writingMode: { default: "horizontal-tb" }
      }
    },
    paragraph: { content: "inline*", group: "block", attrs: languageAttrs },
    heading: {
      content: "inline*",
      group: "block",
      defining: true,
      attrs: { level: { default: 1 }, ...languageAttrs }
    },
    blockquote: { content: "block+", group: "block", defining: true },
    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: { order: { default: 1 } }
    },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*", defining: true },
    code_block: {
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      attrs: { language: { default: null } }
    },
    math_block: {
      group: "block",
      atom: true,
      attrs: { source: { default: "" }, displayMode: { default: true } }
    },
    mermaid_block: {
      group: "block",
      atom: true,
      attrs: { source: { default: "" }, rendererVersion: { default: null } }
    },
    attachment: {
      group: "block",
      atom: true,
      attrs: { assetId: {}, mediaType: {}, title: { default: null } }
    },
    horizontal_rule: { group: "block" },
    text: { group: "inline" },
    math_inline: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { source: { default: "" } }
    },
    hard_break: { inline: true, group: "inline", selectable: false }
  },
  marks: {
    bold: {},
    italic: {},
    underline: {},
    strike: {},
    code: { excludes: "_" },
    link: {
      inclusive: false,
      attrs: { href: {}, title: { default: null } }
    }
  }
});

export function createEmptyEditorDocument({
  language = "und",
  direction = "auto",
  writingMode = "horizontal-tb"
} = {}) {
  return komyakuSchema.node("doc", { language, direction, writingMode }, [
    komyakuSchema.node("paragraph")
  ]);
}

export function createEditorState({ document = createEmptyEditorDocument() } = {}) {
  return EditorState.create({
    doc: document,
    plugins: [history(), keymap(baseKeymap)]
  });
}


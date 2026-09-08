import { parseCanonicalDocument } from "@komyaku/document-schema";

const MAX_DIFF_GRAPHEMES = 1_000_000;

export function segmentGraphemes(text, locale = "und") {
  return Array.from(new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stableValue(nested)]));
  return value;
}

function equal(left, right) { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); }

export function diffGraphemeText(before, after, locale = "und") {
  const left = segmentGraphemes(before, locale);
  const right = segmentGraphemes(after, locale);
  if (left.length + right.length > MAX_DIFF_GRAPHEMES) throw new Error("text_diff_grapheme_limit");
  let prefixLength = 0;
  while (prefixLength < left.length && prefixLength < right.length
    && left[prefixLength] === right[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (suffixLength < left.length - prefixLength && suffixLength < right.length - prefixLength
    && left[left.length - suffixLength - 1] === right[right.length - suffixLength - 1]) suffixLength += 1;
  return Object.freeze({
    prefix: left.slice(0, prefixLength).join(""),
    removed: left.slice(prefixLength, left.length - suffixLength).join(""),
    added: right.slice(prefixLength, right.length - suffixLength).join(""),
    suffix: suffixLength ? left.slice(left.length - suffixLength).join("") : ""
  });
}

function directInline(node) {
  const values = node.type === "diagram" || node.type === "image" ? node.caption : node.content;
  if (!Array.isArray(values)) return [];
  return values.filter((child) => !child?.id);
}

function inlineText(node) {
  return directInline(node).map((child) => {
    if (child.type === "text") return child.text;
    if (child.type === "hard_break") return "\n";
    return "";
  }).join("");
}

function flatten(document) {
  const result = new Map();
  const visit = (node, parentId, index) => {
    if (node.id) result.set(node.id, { node, parentId, index });
    for (const [position, child] of (node.content ?? []).entries()) {
      if (child?.id) visit(child, node.id ?? parentId, position);
    }
    for (const [position, child] of (node.caption ?? []).entries()) {
      if (child?.id) visit(child, node.id ?? parentId, position);
    }
  };
  document.content.forEach((node, index) => visit(node, document.id, index));
  return result;
}

function changedKinds(before, after) {
  const kinds = [];
  if (before.type !== after.type) kinds.push("type");
  if (!equal(before.attrs, after.attrs)) kinds.push("attributes");
  if (!equal(before.metadata, after.metadata) || !equal(before.extensions, after.extensions)) kinds.push("metadata");
  if (!equal(before.renderArtifacts, after.renderArtifacts)) kinds.push("asset-metadata");
  if (before.source !== after.source || before.sourceType !== after.sourceType) kinds.push("source");
  if (before.assetId !== after.assetId || before.mediaType !== after.mediaType
    || before.fileName !== after.fileName || before.altText !== after.altText
    || before.title !== after.title || before.description !== after.description) kinds.push("asset");
  const inlineFormat = (node) => directInline(node).map((value) => ({ type: value.type, marks: value.marks ?? [] }));
  if (!equal(inlineFormat(before), inlineFormat(after))) kinds.push("text-format");
  return kinds;
}

export function compareCanonicalDocuments(beforeInput, afterInput, { locale } = {}) {
  const before = parseCanonicalDocument(beforeInput);
  const after = parseCanonicalDocument(afterInput);
  if (before.id !== after.id) throw new Error("document_diff_identity_mismatch");
  const language = locale ?? after.attrs.language ?? "und";
  const left = flatten(before);
  const right = flatten(after);
  const changes = [];
  for (const [nodeId, previous] of left) {
    const next = right.get(nodeId);
    if (!next) {
      changes.push(Object.freeze({ nodeId, type: previous.node.type, change: "removed",
        from: Object.freeze({ parentId: previous.parentId, index: previous.index }) }));
      continue;
    }
    const moved = previous.parentId !== next.parentId || previous.index !== next.index;
    const kinds = changedKinds(previous.node, next.node);
    const previousText = inlineText(previous.node);
    const nextText = inlineText(next.node);
    const textChanged = previousText !== nextText;
    if (textChanged) kinds.push("text");
    if (moved || kinds.length > 0) changes.push(Object.freeze({
      nodeId, type: next.node.type, change: moved && kinds.length ? "moved-and-changed" : moved ? "moved" : "changed",
      kinds: Object.freeze(kinds),
      from: Object.freeze({ parentId: previous.parentId, index: previous.index }),
      to: Object.freeze({ parentId: next.parentId, index: next.index }),
      textDiff: textChanged ? diffGraphemeText(previousText, nextText, language) : null
    }));
  }
  for (const [nodeId, next] of right) {
    if (!left.has(nodeId)) changes.push(Object.freeze({ nodeId, type: next.node.type, change: "added",
      to: Object.freeze({ parentId: next.parentId, index: next.index }) }));
  }
  const order = new Map(["removed", "added", "moved", "changed", "moved-and-changed"].map((value, index) => [value, index]));
  changes.sort((a, b) => (order.get(a.change) - order.get(b.change)) || a.nodeId.localeCompare(b.nodeId));
  const summary = { added: 0, removed: 0, moved: 0, changed: 0 };
  for (const change of changes) {
    if (change.change === "added" || change.change === "removed") summary[change.change] += 1;
    else {
      if (change.change.includes("moved")) summary.moved += 1;
      if (change.change.includes("changed")) summary.changed += 1;
    }
  }
  return Object.freeze({ documentId: before.id, summary: Object.freeze(summary), changes: Object.freeze(changes) });
}

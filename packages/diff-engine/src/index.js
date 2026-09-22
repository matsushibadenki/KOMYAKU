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
  if (before.source !== after.source || before.sourceType !== after.sourceType
    || before.language !== after.language || before.displayMode !== after.displayMode) kinds.push("source");
  if (before.assetId !== after.assetId || before.mediaType !== after.mediaType
    || before.fileName !== after.fileName || before.altText !== after.altText
    || before.title !== after.title || before.description !== after.description
    || before.width !== after.width || before.height !== after.height) kinds.push("asset");
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

function positionEqual(left, right) {
  return left?.parentId === right?.parentId && left?.index === right?.index;
}

function conflictValue(node, kind) {
  switch (kind) {
    case "text": return inlineText(node);
    case "text-format": return directInline(node).map(({ type, marks = [] }) => ({ type, marks }));
    case "metadata": return [node.metadata, node.extensions];
    case "asset-metadata": return node.renderArtifacts;
    case "source": return [node.source, node.sourceType, node.language, node.displayMode];
    case "asset": return [node.assetId, node.mediaType, node.fileName, node.altText,
      node.title, node.description, node.width, node.height];
    case "type": return node.type;
    case "attributes": return node.attrs;
    default: return node;
  }
}

function removedRoots(changes, baseNodes) {
  const removed = new Set(changes.filter(({ change }) => change === "removed")
    .map(({ nodeId }) => nodeId));
  return [...removed].filter((id) => !removed.has(baseNodes.get(id)?.parentId));
}

function changedSubtrees(changes, baseNodes, otherNodes, documentId) {
  const affected = new Set();
  for (const { nodeId, change } of changes) {
    if (change === "removed") continue;
    for (const nodes of [baseNodes, otherNodes]) {
      let id = nodeId;
      const seen = new Set();
      while (id && id !== documentId && !seen.has(id)) {
        affected.add(id);
        seen.add(id);
        id = nodes.get(id)?.parentId;
      }
    }
  }
  return affected;
}

export function compareThreeWayCanonicalDocuments(baseInput, oursInput, theirsInput, { locale } = {}) {
  const base = parseCanonicalDocument(baseInput);
  const ours = parseCanonicalDocument(oursInput);
  const theirs = parseCanonicalDocument(theirsInput);
  if (base.id !== ours.id || base.id !== theirs.id) {
    throw new Error("document_diff_identity_mismatch");
  }
  const oursDiff = compareCanonicalDocuments(base, ours, { locale });
  const theirsDiff = compareCanonicalDocuments(base, theirs, { locale });
  const baseNodes = flatten(base);
  const oursNodes = flatten(ours);
  const theirsNodes = flatten(theirs);
  const oursChanges = new Map(oursDiff.changes.map((change) => [change.nodeId, change]));
  const theirsChanges = new Map(theirsDiff.changes.map((change) => [change.nodeId, change]));
  const oursAffected = changedSubtrees(oursDiff.changes, baseNodes, oursNodes, base.id);
  const theirsAffected = changedSubtrees(theirsDiff.changes, baseNodes, theirsNodes, base.id);
  const conflicts = [];
  const record = (nodeId, kind) => conflicts.push(Object.freeze({ nodeId, kind }));

  for (const rootId of removedRoots(oursDiff.changes, baseNodes)) {
    if (theirsAffected.has(rootId)) record(rootId, "delete-edit");
  }
  for (const rootId of removedRoots(theirsDiff.changes, baseNodes)) {
    if (oursAffected.has(rootId)
      && !conflicts.some((item) => item.nodeId === rootId && item.kind === "delete-edit")) {
      record(rootId, "delete-edit");
    }
  }

  for (const [nodeId, oursChange] of oursChanges) {
    const theirsChange = theirsChanges.get(nodeId);
    if (!theirsChange || oursChange.change === "removed" || theirsChange.change === "removed") continue;
    const oursEntry = oursNodes.get(nodeId);
    const theirsEntry = theirsNodes.get(nodeId);
    if (oursChange.change === "added" && theirsChange.change === "added") {
      if (!equal(oursEntry.node, theirsEntry.node) || !positionEqual(oursEntry, theirsEntry)) {
        record(nodeId, "add-add");
      }
      continue;
    }
    const baseEntry = baseNodes.get(nodeId);
    if (!baseEntry || !oursEntry || !theirsEntry) continue;
    const oursMoved = !positionEqual(baseEntry, oursEntry);
    const theirsMoved = !positionEqual(baseEntry, theirsEntry);
    if (oursMoved && theirsMoved && !positionEqual(oursEntry, theirsEntry)) record(nodeId, "move");
    const sharedKinds = (oursChange.kinds ?? []).filter((kind) =>
      (theirsChange.kinds ?? []).includes(kind));
    for (const kind of sharedKinds) {
      if (!equal(conflictValue(oursEntry.node, kind), conflictValue(theirsEntry.node, kind))) {
        record(nodeId, kind);
      }
    }
  }
  for (const kind of ["metadata", "attributes", "extensions"]) {
    const key = kind === "attributes" ? "attrs" : kind;
    if (!equal(base[key], ours[key]) && !equal(base[key], theirs[key])
      && !equal(ours[key], theirs[key])) record(base.id, kind);
  }
  conflicts.sort((left, right) => left.nodeId.localeCompare(right.nodeId)
    || left.kind.localeCompare(right.kind));
  return Object.freeze({ documentId: base.id, ours: oursDiff, theirs: theirsDiff,
    conflicts: Object.freeze(conflicts) });
}

import * as Y from "yjs";
import {
  getRelativeSelection,
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  relativePositionToAbsolutePosition,
  undoCommand,
  redoCommand,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin
} from "y-prosemirror";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { canonicalToEditorDocument, editorToCanonicalDocument } from "./canonical-adapter.js";
import { createStableNodeIdentityPlugin, komyakuSchema } from "./prosemirror-schema.js";
import { DOCUMENT_SCHEMA_VERSION, createNodeId, inlineNodeSchema } from "@komyaku/document-schema";

export const COLLABORATIVE_FRAGMENT_NAME = "komyaku:document-content";
export const COLLABORATIVE_METADATA_NAME = "komyaku:document-metadata";

export const COLLABORATION_ORIGINS = Object.freeze({
  initialize: Symbol.for("@komyaku/collaboration/initialize"),
  localUser: Symbol.for("@komyaku/collaboration/local-user"),
  remote: Symbol.for("@komyaku/collaboration/remote"),
  ai: Symbol.for("@komyaku/collaboration/ai"),
  import: Symbol.for("@komyaku/collaboration/import"),
  migration: Symbol.for("@komyaku/collaboration/migration"),
  normalization: Symbol.for("@komyaku/collaboration/normalization")
});

export const DEFAULT_COLLABORATION_LIMITS = Object.freeze({
  maxIncomingUpdateBytes: 1024 * 1024,
  maxOutgoingUpdateBytes: 8 * 1024 * 1024,
  maxStateVectorBytes: 64 * 1024
});

export class CollaborativeStateError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "CollaborativeStateError";
    this.code = code;
  }
}

function bytes(value, code) {
  if (!(value instanceof Uint8Array)) throw new CollaborativeStateError(code);
  return value;
}

function assertBounded(value, maximum, code) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new CollaborativeStateError("invalid_collaboration_limit");
  }
  if (value.byteLength > maximum) {
    throw new CollaborativeStateError(code, `${code}: ${value.byteLength} > ${maximum}`);
  }
  return value;
}

function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function documentAttributes(editorDocument) {
  return {
    documentId: editorDocument.attrs.documentId,
    schemaVersion: editorDocument.attrs.schemaVersion,
    language: editorDocument.attrs.language,
    direction: editorDocument.attrs.direction,
    writingMode: editorDocument.attrs.writingMode,
    metadata: jsonClone(editorDocument.attrs.metadata),
    extensions: jsonClone(editorDocument.attrs.extensions)
  };
}

function writeDocumentAttributes(document, editorDocument) {
  const metadata = document.getMap(COLLABORATIVE_METADATA_NAME);
  for (const [key, value] of Object.entries(documentAttributes(editorDocument))) {
    metadata.set(key, value);
  }
}

function readDocumentAttributes(document) {
  const metadata = document.getMap(COLLABORATIVE_METADATA_NAME);
  const documentId = metadata.get("documentId");
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new CollaborativeStateError("missing_collaborative_document_id");
  }
  return {
    documentId,
    schemaVersion: metadata.get("schemaVersion"),
    language: metadata.get("language"),
    direction: metadata.get("direction"),
    writingMode: metadata.get("writingMode"),
    metadata: jsonClone(metadata.get("metadata") ?? {}),
    extensions: jsonClone(metadata.get("extensions") ?? {})
  };
}

function assertStableNodeIds(editorDocument) {
  const nodeIds = new Set();
  editorDocument.descendants((node) => {
    if (node.isText || node.type.name === "hard_break") return;
    if (typeof node.attrs?.nodeId !== "string" || node.attrs.nodeId.length === 0) {
      throw new CollaborativeStateError(
        "missing_stable_node_id",
        `Collaborative checkpoint contains ${node.type.name} without a stable Node ID`
      );
    }
    if (nodeIds.has(node.attrs.nodeId)) {
      throw new CollaborativeStateError(
        "duplicate_stable_node_id",
        `Collaborative checkpoint contains duplicate Node ID: ${node.attrs.nodeId}`
      );
    }
    nodeIds.add(node.attrs.nodeId);
  });
}

function editorDocumentFromWorkingState(document) {
  const fragment = getCollaborativeFragment(document);
  try {
    const initialized = initProseMirrorDoc(fragment, komyakuSchema);
    const editorDocument = komyakuSchema.topNodeType.create(
      readDocumentAttributes(document),
      initialized.doc.content
    );
    assertStableNodeIds(editorDocument);
    return { editorDocument, mapping: initialized.mapping };
  } catch (error) {
    if (error instanceof CollaborativeStateError) throw error;
    throw new CollaborativeStateError("invalid_collaborative_editor_state", undefined, { cause: error });
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

async function sha256Hex(bytesValue) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesValue));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createCollaborativeWorkingState(canonicalDocument, {
  guid,
  origin = COLLABORATION_ORIGINS.initialize
} = {}) {
  const editorDocument = canonicalToEditorDocument(canonicalDocument);
  const document = new Y.Doc(guid ? { guid } : undefined);
  document.transact(() => {
    prosemirrorToYXmlFragment(
      editorDocument,
      document.getXmlFragment(COLLABORATIVE_FRAGMENT_NAME)
    );
    writeDocumentAttributes(document, editorDocument);
  }, origin);
  return document;
}

export function createEmptyCollaborativeWorkingState({ guid } = {}) {
  return new Y.Doc(guid ? { guid } : undefined);
}

export function getCollaborativeFragment(document) {
  if (!(document instanceof Y.Doc)) throw new CollaborativeStateError("invalid_collaborative_document");
  return document.getXmlFragment(COLLABORATIVE_FRAGMENT_NAME);
}

export function encodeCollaborativeStateVector(document, {
  maxBytes = DEFAULT_COLLABORATION_LIMITS.maxStateVectorBytes
} = {}) {
  return assertBounded(
    Y.encodeStateVector(document),
    maxBytes,
    "collaborative_state_vector_too_large"
  );
}

export function encodeCollaborativeUpdate(document, {
  stateVector,
  maxBytes = DEFAULT_COLLABORATION_LIMITS.maxOutgoingUpdateBytes,
  maxStateVectorBytes = DEFAULT_COLLABORATION_LIMITS.maxStateVectorBytes
} = {}) {
  if (stateVector !== undefined) {
    assertBounded(
      bytes(stateVector, "invalid_collaborative_state_vector"),
      maxStateVectorBytes,
      "collaborative_state_vector_too_large"
    );
  }
  return assertBounded(
    Y.encodeStateAsUpdate(document, stateVector),
    maxBytes,
    "collaborative_update_too_large"
  );
}

export function applyCollaborativeUpdate(document, update, {
  origin = COLLABORATION_ORIGINS.remote,
  maxBytes = DEFAULT_COLLABORATION_LIMITS.maxIncomingUpdateBytes
} = {}) {
  const bounded = assertBounded(
    bytes(update, "invalid_collaborative_update"),
    maxBytes,
    "collaborative_update_too_large"
  );
  try {
    Y.applyUpdate(document, bounded, origin);
  } catch (error) {
    throw new CollaborativeStateError("malformed_collaborative_update", undefined, { cause: error });
  }
}

export function connectCollaborativeWorkingStates(left, right, {
  maxBytes = DEFAULT_COLLABORATION_LIMITS.maxOutgoingUpdateBytes
} = {}) {
  if (!(left instanceof Y.Doc) || !(right instanceof Y.Doc) || left === right) {
    throw new CollaborativeStateError("invalid_collaborative_replica_pair");
  }
  const bridgeOrigin = Symbol("komyaku-in-memory-collaboration-bridge");
  const send = (target, update) => {
    assertBounded(update, maxBytes, "collaborative_update_too_large");
    Y.applyUpdate(target, update, bridgeOrigin);
  };
  const sendLeft = (update, origin) => {
    if (origin !== bridgeOrigin) send(right, update);
  };
  const sendRight = (update, origin) => {
    if (origin !== bridgeOrigin) send(left, update);
  };

  send(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
  send(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
  left.on("update", sendLeft);
  right.on("update", sendRight);

  let connected = true;
  return () => {
    if (!connected) return;
    connected = false;
    left.off("update", sendLeft);
    right.off("update", sendRight);
  };
}

export function createLocalUndoManager(document, {
  trackedOrigins = [COLLABORATION_ORIGINS.localUser],
  captureTimeout = 500
} = {}) {
  return new Y.UndoManager(getCollaborativeFragment(document), {
    trackedOrigins: new Set(trackedOrigins),
    captureTimeout
  });
}

export function createCollaborativeEditorState(document, { plugins = [] } = {}) {
  const fragment = getCollaborativeFragment(document);
  const projection = editorDocumentFromWorkingState(document);
  return EditorState.create({
    doc: projection.editorDocument,
    plugins: [
      createStableNodeIdentityPlugin(),
      ySyncPlugin(fragment, { mapping: projection.mapping }),
      yUndoPlugin(),
      keymap({ "Mod-z": undoCommand, "Mod-y": redoCommand, "Mod-Shift-z": redoCommand }),
      keymap(baseKeymap),
      ...plugins
    ]
  });
}

export function createCollaborativeEditorView(mount, document, {
  plugins = [],
  nodeViews = {},
  onTransaction = () => {}
} = {}) {
  if (!(mount instanceof Element)) throw new CollaborativeStateError("invalid_editor_mount");
  return new EditorView(mount, {
    state: createCollaborativeEditorState(document, { plugins }),
    nodeViews,
    dispatchTransaction(transaction) {
      const result = this.state.applyTransaction(transaction);
      this.updateState(result.state);
      onTransaction({ transaction, transactions: result.transactions, view: this });
    }
  });
}

export function insertCollaborativeImage(view, {
  assetId,
  mediaType = "image/png",
  altText,
  width,
  height,
  nodeId = createNodeId()
}) {
  if (!(view instanceof EditorView) || view.isDestroyed) {
    throw new CollaborativeStateError("invalid_editor_view");
  }
  if (
    typeof assetId !== "string" || assetId.length === 0 ||
    mediaType !== "image/png" ||
    typeof altText !== "string" || altText.trim().length === 0 ||
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1
  ) {
    throw new CollaborativeStateError("invalid_image_insertion");
  }
  const node = view.state.schema.nodes.image.create({
    nodeId,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: {},
    extensions: {},
    renderArtifacts: [],
    provenance: null,
    assetId,
    mediaType,
    altText: altText.trim(),
    caption: [],
    width,
    height
  });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
  return node;
}

export function insertCollaborativeFile(view, {
  assetId,
  mediaType,
  fileName,
  title = null,
  description = null,
  nodeId = createNodeId()
}) {
  if (!(view instanceof EditorView) || view.isDestroyed) {
    throw new CollaborativeStateError("invalid_editor_view");
  }
  if (typeof assetId !== "string" || assetId.length === 0
    || typeof mediaType !== "string" || mediaType.length < 1 || mediaType.length > 200
    || typeof fileName !== "string" || fileName.trim().length < 1 || fileName.length > 1000
    || (title !== null && (typeof title !== "string" || title.length > 1000))
    || (description !== null && (typeof description !== "string" || description.length > 10_000))) {
    throw new CollaborativeStateError("invalid_file_insertion");
  }
  const node = view.state.schema.nodes.file.create({
    nodeId,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: {},
    extensions: {},
    renderArtifacts: [],
    provenance: null,
    assetId,
    mediaType,
    fileName: fileName.trim(),
    title: title?.trim() || null,
    description: description?.trim() || null
  });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
  return node;
}

function plainCaption(text) {
  const value = text.trim();
  return value.length === 0 ? [] : [{
    type: "text",
    text: value,
    marks: [],
    metadata: {},
    extensions: {}
  }];
}

function validatedCaption(caption, occupiedNodeIds = new Set()) {
  if (!Array.isArray(caption) || caption.length > 256) {
    throw new CollaborativeStateError("invalid_image_caption");
  }
  let sourceLength = 0;
  const captionNodeIds = new Set();
  const parsed = caption.map((inline) => {
    const result = inlineNodeSchema.safeParse(inline);
    if (!result.success) throw new CollaborativeStateError("invalid_image_caption");
    sourceLength += result.data.type === "text" ? result.data.text.length
      : result.data.type === "math_inline" ? result.data.source.length : 1;
    if (result.data.type === "math_inline") {
      if (occupiedNodeIds.has(result.data.id) || captionNodeIds.has(result.data.id)) {
        throw new CollaborativeStateError("invalid_image_caption");
      }
      captionNodeIds.add(result.data.id);
    }
    return result.data;
  });
  if (sourceLength > 10_000) throw new CollaborativeStateError("invalid_image_caption");
  return parsed;
}

export function updateCollaborativeImageAccessibility(view, {
  nodeId,
  altText,
  captionText,
  caption
}) {
  if (!(view instanceof EditorView) || view.isDestroyed) {
    throw new CollaborativeStateError("invalid_editor_view");
  }
  if (
    typeof nodeId !== "string" || nodeId.length === 0 ||
    typeof altText !== "string" || altText.trim().length === 0 || altText.length > 10_000 ||
    (captionText !== undefined && (typeof captionText !== "string" || captionText.length > 10_000)) ||
    (captionText !== undefined && caption !== undefined)
  ) {
    throw new CollaborativeStateError("invalid_image_accessibility_update");
  }
  let position = null;
  let image = null;
  view.state.doc.descendants((node, nodePosition) => {
    if (image || node.type.name !== "image" || node.attrs.nodeId !== nodeId) return;
    position = nodePosition;
    image = node;
  });
  if (!image || position === null) throw new CollaborativeStateError("image_node_not_found");
  const occupiedNodeIds = new Set();
  view.state.doc.descendants((node) => {
    if (typeof node.attrs?.nodeId === "string") occupiedNodeIds.add(node.attrs.nodeId);
    if (node === image) return;
    for (const inline of node.attrs?.caption ?? []) {
      if (inline.type === "math_inline" && typeof inline.id === "string") occupiedNodeIds.add(inline.id);
    }
  });
  const nextCaption = caption !== undefined ? validatedCaption(caption, occupiedNodeIds)
    : captionText !== undefined ? plainCaption(captionText) : image.attrs.caption;
  view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
    ...image.attrs,
    altText: altText.trim(),
    caption: nextCaption
  }, image.marks).scrollIntoView());
  return true;
}

export function captureCollaborativeSelection(view) {
  const syncState = ySyncPluginKey.getState(view?.state);
  if (!syncState?.binding) return null;
  const selection = getRelativeSelection(syncState.binding, view.state);
  return {
    type: selection.type,
    anchor: Y.encodeRelativePosition(selection.anchor),
    head: Y.encodeRelativePosition(selection.head)
  };
}

export function restoreCollaborativeSelection(view, encodedSelection, { focus = false } = {}) {
  if (!encodedSelection?.anchor || !encodedSelection?.head) return false;
  const syncState = ySyncPluginKey.getState(view?.state);
  if (!syncState?.binding) return false;
  try {
    const anchor = relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.decodeRelativePosition(encodedSelection.anchor),
      syncState.binding.mapping
    );
    const head = relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.decodeRelativePosition(encodedSelection.head),
      syncState.binding.mapping
    );
    if (anchor === null || head === null) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    if (focus) view.focus();
    return true;
  } catch {
    return false;
  }
}

export async function createCanonicalCheckpoint(document) {
  if (!(document instanceof Y.Doc)) throw new CollaborativeStateError("invalid_collaborative_document");
  const { editorDocument } = editorDocumentFromWorkingState(document);

  let canonicalDocument;
  try {
    canonicalDocument = editorToCanonicalDocument(editorDocument);
  } catch (error) {
    throw new CollaborativeStateError("invalid_canonical_checkpoint", undefined, { cause: error });
  }
  const json = JSON.stringify(stableValue(canonicalDocument));
  const encoded = new TextEncoder().encode(json);
  return {
    document: canonicalDocument,
    json,
    bytes: encoded,
    byteLength: encoded.byteLength,
    hashAlgorithm: "sha256",
    hash: await sha256Hex(encoded)
  };
}

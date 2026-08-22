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
import { komyakuSchema } from "./prosemirror-schema.js";

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
  editorDocument.descendants((node) => {
    if (node.isText || node.type.name === "hard_break") return;
    if (typeof node.attrs?.nodeId !== "string" || node.attrs.nodeId.length === 0) {
      throw new CollaborativeStateError(
        "missing_stable_node_id",
        `Collaborative checkpoint contains ${node.type.name} without a stable Node ID`
      );
    }
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
  onTransaction = () => {}
} = {}) {
  if (!(mount instanceof Element)) throw new CollaborativeStateError("invalid_editor_mount");
  return new EditorView(mount, {
    state: createCollaborativeEditorState(document, { plugins }),
    dispatchTransaction(transaction) {
      this.updateState(this.state.apply(transaction));
      onTransaction({ transaction, view: this });
    }
  });
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

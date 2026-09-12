import { invoke } from "@tauri-apps/api/core";
import { parseCanonicalDocument } from "@komyaku/document-schema";
import { compareCanonicalDocuments } from "@komyaku/diff-engine";
import {
  createDocumentVersion,
  VERSION_SNAPSHOT_ENCODING
} from "@komyaku/version-engine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

const LOCAL_AUTHOR_ID_KEY = "komyaku:local-version-author:v1";

export function localVersionHistoryAvailable() { return isTauriRuntime(); }

export function getOrCreateLocalVersionAuthorId({
  storage = globalThis.localStorage,
  idFactory = () => crypto.randomUUID()
} = {}) {
  const existing = storage?.getItem(LOCAL_AUTHOR_ID_KEY);
  if (existing && UUID.test(existing)) return existing;
  const created = idFactory();
  if (!UUID.test(created)) throw new Error("invalid_local_version_author_id");
  storage?.setItem(LOCAL_AUTHOR_ID_KEY, created);
  return created;
}

function parseHistory(value, documentId) {
  if (!value || value.documentId !== documentId
    || (value.currentBranchId !== null && !UUID.test(value.currentBranchId))
    || (value.currentVersionId !== null && !UUID.test(value.currentVersionId))
    || !Array.isArray(value.branches) || !Array.isArray(value.versions)) {
    throw new Error("invalid_local_version_history");
  }
  const branches = value.branches.map((branch) => {
    if (!branch || !UUID.test(branch.id) || !UUID.test(branch.headVersionId)
      || typeof branch.name !== "string" || !branch.name.trim()
      || typeof branch.createdAt !== "string" || typeof branch.updatedAt !== "string") {
      throw new Error("invalid_local_version_history");
    }
    return Object.freeze({ ...branch });
  });
  const versions = value.versions.map((version) => {
    const parentIds = version?.parentIds ?? [];
    if (!version || !UUID.test(version.id) || !HASH.test(version.snapshotHash)
      || !UUID.test(version.authorId) || typeof version.reason !== "string"
      || (version.restoredFromVersionId !== null && !UUID.test(version.restoredFromVersionId))
      || (version.label !== null && typeof version.label !== "string")
      || typeof version.createdAt !== "string" || !Array.isArray(parentIds)
      || parentIds.length > 2 || parentIds.some((id) => !UUID.test(id))
      || new Set(parentIds).size !== parentIds.length) {
      throw new Error("invalid_local_version_history");
    }
    return Object.freeze({ ...version, parentIds: Object.freeze([...parentIds]) });
  });
  const rawCursor = value.nextCursor ?? null;
  const nextCursor = rawCursor === null ? null : (() => {
    if (!rawCursor || typeof rawCursor.createdAt !== "string" || !rawCursor.createdAt
      || rawCursor.createdAt.length > 64 || !UUID.test(rawCursor.versionId)) {
      throw new Error("invalid_local_version_history");
    }
    const last = versions.at(-1);
    if (!last || last.createdAt !== rawCursor.createdAt || last.id !== rawCursor.versionId) {
      throw new Error("invalid_local_version_history");
    }
    return Object.freeze({ ...rawCursor });
  })();
  return Object.freeze({ ...value, branches: Object.freeze(branches),
    versions: Object.freeze(versions), nextCursor });
}

export async function listLocalVersionHistory(documentId, {
  invokeImpl = invoke,
  native = isTauriRuntime(),
  cursor = null
} = {}) {
  if (!native) return Object.freeze({
    documentId, currentBranchId: null, currentVersionId: null,
    branches: Object.freeze([]), versions: Object.freeze([]), nextCursor: null, available: false
  });
  if (!UUID.test(documentId)) throw new Error("invalid_local_document_id");
  if (cursor !== null && (!cursor || typeof cursor.createdAt !== "string" || !cursor.createdAt
    || cursor.createdAt.length > 64 || !UUID.test(cursor.versionId))) {
    throw new Error("invalid_local_version_history_cursor");
  }
  return parseHistory(await invokeImpl("list_local_version_history", {
    documentId,
    cursorCreatedAt: cursor?.createdAt ?? null,
    cursorVersionId: cursor?.versionId ?? null
  }), documentId);
}

export function appendLocalVersionHistoryPage(history, page) {
  if (!history || !page || history.documentId !== page.documentId
    || history.currentBranchId !== page.currentBranchId
    || history.currentVersionId !== page.currentVersionId) {
    throw new Error("invalid_local_version_history_page");
  }
  const knownIds = new Set(history.versions.map(({ id }) => id));
  if (page.versions.some(({ id }) => knownIds.has(id))) {
    throw new Error("invalid_local_version_history_page");
  }
  const newestOlderVersion = page.versions[0];
  const oldestLoadedVersion = history.versions.at(-1);
  if (newestOlderVersion && oldestLoadedVersion
    && (newestOlderVersion.createdAt > oldestLoadedVersion.createdAt
      || (newestOlderVersion.createdAt === oldestLoadedVersion.createdAt
        && newestOlderVersion.id >= oldestLoadedVersion.id))) {
    throw new Error("invalid_local_version_history_page");
  }
  return Object.freeze({ ...history, branches: page.branches,
    versions: Object.freeze([...history.versions, ...page.versions]), nextCursor: page.nextCursor });
}

export async function loadLocalVersionSnapshot({ documentId, versionId }, {
  invokeImpl = invoke,
  native = isTauriRuntime()
} = {}) {
  if (!native || !UUID.test(documentId) || !UUID.test(versionId)) {
    throw new Error("invalid_local_version_reference");
  }
  const value = await invokeImpl("load_local_version_snapshot", { documentId, versionId });
  if (!value || value.documentId !== documentId || value.versionId !== versionId
    || value.snapshotEncoding !== VERSION_SNAPSHOT_ENCODING || !HASH.test(value.snapshotHash)
    || typeof value.snapshotJson !== "string") {
    throw new Error("invalid_local_version_snapshot");
  }
  const document = parseCanonicalDocument(JSON.parse(value.snapshotJson));
  if (document.id !== documentId || document.schemaVersion !== value.schemaVersion) {
    throw new Error("invalid_local_version_snapshot");
  }
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value.snapshotJson)
  ));
  const actualHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actualHash !== value.snapshotHash) throw new Error("invalid_local_version_snapshot");
  return Object.freeze({ ...value, document });
}

export async function loadLocalVersionAssets({ documentId, versionId }, {
  invokeImpl = invoke,
  native = isTauriRuntime()
} = {}) {
  if (!native || !UUID.test(documentId) || !UUID.test(versionId)) {
    throw new Error("invalid_local_version_reference");
  }
  const values = await invokeImpl("load_local_version_assets", { documentId, versionId });
  if (!Array.isArray(values) || values.length > 5000) throw new Error("invalid_local_version_assets");
  let totalBytes = 0;
  const assets = [];
  for (const value of values) {
    const bytes = value?.bytes instanceof Uint8Array ? value.bytes : new Uint8Array(value?.bytes ?? []);
    totalBytes += bytes.byteLength;
    if (!value || !UUID.test(value.id) || typeof value.mediaType !== "string" || !value.mediaType
      || !HASH.test(value.contentHash) || bytes.byteLength < 1 || totalBytes > 512 * 1024 * 1024) {
      throw new Error("invalid_local_version_assets");
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actualHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actualHash !== value.contentHash) throw new Error("invalid_local_version_assets");
    assets.push(Object.freeze({ id: value.id, mediaType: value.mediaType, bytes }));
  }
  return Object.freeze(assets);
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export async function loadLocalHistoryArchiveSource(documentId, {
  concurrency = 4,
  ...options
} = {}) {
  if (!UUID.test(documentId) || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("invalid_local_history_archive_request");
  }
  let history = await listLocalVersionHistory(documentId, options);
  let pageCount = 1;
  while (history.nextCursor) {
    if (history.versions.length >= 5000 || pageCount >= 50) {
      throw new Error("local_history_archive_version_limit");
    }
    const page = await listLocalVersionHistory(documentId, { ...options, cursor: history.nextCursor });
    history = appendLocalVersionHistoryPage(history, page);
    pageCount += 1;
  }
  if (!history.currentBranchId || !history.currentVersionId || history.versions.length < 1) {
    throw new Error("local_history_archive_empty");
  }
  const archiveVersions = new Array(history.versions.length);
  const assetsById = new Map();
  let totalAssetBytes = 0;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < history.versions.length) {
      const index = nextIndex;
      nextIndex += 1;
      const metadata = history.versions[index];
      const [snapshot, assets] = await Promise.all([
        loadLocalVersionSnapshot({ documentId, versionId: metadata.id }, options),
        loadLocalVersionAssets({ documentId, versionId: metadata.id }, options)
      ]);
      if (snapshot.snapshotHash !== metadata.snapshotHash) {
        throw new Error("local_history_archive_snapshot_changed");
      }
      archiveVersions[index] = Object.freeze({
        ...metadata,
        schemaVersion: snapshot.schemaVersion,
        snapshotEncoding: snapshot.snapshotEncoding,
        snapshotJson: snapshot.snapshotJson
      });
      for (const asset of assets) {
        const existing = assetsById.get(asset.id);
        if (existing && (existing.mediaType !== asset.mediaType || !sameBytes(existing.bytes, asset.bytes))) {
          throw new Error("local_history_archive_asset_conflict");
        }
        if (!existing) {
          totalAssetBytes += asset.bytes.byteLength;
          if (totalAssetBytes > 512 * 1024 * 1024) {
            throw new Error("local_history_archive_size_limit");
          }
          assetsById.set(asset.id, asset);
        }
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, history.versions.length) }, () => worker()
  ));
  const confirmation = await listLocalVersionHistory(documentId, options);
  const originalBranches = history.branches.map(({ id, name, headVersionId }) => ({ id, name, headVersionId }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const confirmedBranches = confirmation.branches.map(({ id, name, headVersionId }) => ({ id, name, headVersionId }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (confirmation.currentBranchId !== history.currentBranchId
    || confirmation.currentVersionId !== history.currentVersionId
    || JSON.stringify(confirmedBranches) !== JSON.stringify(originalBranches)) {
    throw new Error("local_history_archive_changed");
  }
  return Object.freeze({
    documentId,
    currentBranchId: history.currentBranchId,
    currentVersionId: history.currentVersionId,
    versions: Object.freeze(archiveVersions),
    branches: history.branches,
    assets: Object.freeze([...assetsById.values()])
  });
}

export async function compareLocalDocumentVersions({ documentId, beforeVersionId, afterVersionId, locale }, options = {}) {
  if (!UUID.test(documentId) || !UUID.test(beforeVersionId) || !UUID.test(afterVersionId)
    || beforeVersionId === afterVersionId) throw new Error("invalid_local_version_comparison");
  const [before, after] = await Promise.all([
    loadLocalVersionSnapshot({ documentId, versionId: beforeVersionId }, options),
    loadLocalVersionSnapshot({ documentId, versionId: afterVersionId }, options)
  ]);
  return compareCanonicalDocuments(before.document, after.document, { locale });
}

export function parseSavedLocalVersion(value, expected) {
  if (!value || !UUID.test(value.operationId) || !UUID.test(value.documentId)
    || !UUID.test(value.versionId) || !UUID.test(value.branchId)
    || !HASH.test(value.snapshotHash) || typeof value.replayed !== "boolean"
    || value.operationId !== expected.operationId
    || value.documentId !== expected.version.documentId
    || value.versionId !== expected.version.id
    || value.branchId !== expected.branchId
    || value.snapshotHash !== expected.version.snapshotHash) {
    throw new Error("invalid_local_version_result");
  }
  return Object.freeze({ ...value });
}

export async function saveLocalVersion(input, {
  invokeImpl = invoke,
  native = isTauriRuntime()
} = {}) {
  if (!native || !input || !UUID.test(input.operationId) || !UUID.test(input.branchId)
    || typeof input.branchName !== "string" || input.branchName.trim().length === 0
    || !input.version || input.version.snapshotEncoding !== VERSION_SNAPSHOT_ENCODING
    || !UUID.test(input.version.id) || !UUID.test(input.version.documentId)
    || !Array.isArray(input.version.parentIds) || input.version.parentIds.length > 2
    || input.version.parentIds.some((id) => !UUID.test(id))
    || !HASH.test(input.version.snapshotHash)
    || (input.restoreDraftRevision != null && (!Number.isSafeInteger(input.restoreDraftRevision)
      || input.restoreDraftRevision < 1))) {
    throw new Error("invalid_local_version_request");
  }
  const result = await invokeImpl("save_local_version_atomic", { input });
  return parseSavedLocalVersion(result, input);
}

export async function createLocalDocumentVersion({
  document, history, authorId, kind, label = null, branchName = null,
  now = () => new Date(), idFactory = () => crypto.randomUUID()
}, options = {}) {
  if (!history || history.documentId !== document?.id || !UUID.test(authorId)
    || !["initial", "named", "alternative"].includes(kind)) {
    throw new Error("invalid_local_version_operation");
  }
  const initial = kind === "initial";
  const currentVersionId = history.currentVersionId;
  const currentBranchId = history.currentBranchId;
  if (initial ? history.versions.length !== 0 || currentVersionId !== null
    : !UUID.test(currentVersionId) || !UUID.test(currentBranchId)) {
    throw new Error("invalid_local_version_base");
  }
  const alternative = kind === "alternative";
  const branchId = initial || alternative ? idFactory() : currentBranchId;
  const resolvedBranchName = branchName?.trim()
    || (initial ? "Main" : alternative ? "Alternative" : history.branches.find(({ id }) => id === branchId)?.name);
  if (!UUID.test(branchId) || !resolvedBranchName || resolvedBranchName.length > 200) {
    throw new Error("invalid_local_version_branch");
  }
  const createdAt = now().toISOString();
  const version = await createDocumentVersion({
    id: idFactory(), document, parentIds: initial ? [] : [currentVersionId],
    authorId, createdAt, reason: initial ? "initial" : "named"
  });
  const normalizedLabel = typeof label === "string" && label.trim() ? label.trim() : null;
  if (normalizedLabel?.length > 1000) throw new Error("invalid_local_version_label");
  const input = {
    operationId: idFactory(), branchId, branchName: resolvedBranchName,
    expectedHeadVersionId: initial ? null : currentVersionId,
    restoreDraftRevision: null, version: { ...version, label: normalizedLabel }
  };
  const receipt = await saveLocalVersion(input, options);
  return Object.freeze({ receipt, version: Object.freeze(input.version), branchId, branchName: resolvedBranchName });
}

export async function restoreLocalDocumentVersion({
  documentId, targetVersionId, history, authorId, localRevision, label = null,
  now = () => new Date(), idFactory = () => crypto.randomUUID()
}, options = {}) {
  if (!history || history.documentId !== documentId || !UUID.test(documentId)
    || !UUID.test(targetVersionId) || !UUID.test(authorId)
    || !UUID.test(history.currentVersionId) || !UUID.test(history.currentBranchId)
    || !Number.isSafeInteger(localRevision) || localRevision < 0) {
    throw new Error("invalid_local_version_restore");
  }
  const branch = history.branches.find(({ id }) => id === history.currentBranchId);
  if (!branch) throw new Error("invalid_local_version_restore");
  const target = await loadLocalVersionSnapshot({ documentId, versionId: targetVersionId }, options);
  const createdAt = now().toISOString();
  const version = await createDocumentVersion({
    id: idFactory(), document: target.document, parentIds: [history.currentVersionId],
    authorId, createdAt, reason: "restore", restoredFromVersionId: targetVersionId
  });
  const normalizedLabel = typeof label === "string" && label.trim() ? label.trim() : null;
  const restoreDraftRevision = localRevision + 1;
  const input = {
    operationId: idFactory(), branchId: history.currentBranchId, branchName: branch.name,
    expectedHeadVersionId: history.currentVersionId, restoreDraftRevision,
    version: { ...version, label: normalizedLabel }
  };
  const receipt = await saveLocalVersion(input, options);
  return Object.freeze({ receipt, version: Object.freeze(input.version),
    document: target.document, localRevision: restoreDraftRevision });
}

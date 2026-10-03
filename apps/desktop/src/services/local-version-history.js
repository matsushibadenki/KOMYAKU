import { invoke } from "@tauri-apps/api/core";
import { collectAssetIds, parseCanonicalDocument } from "@komyaku/document-schema";
import { compareCanonicalDocuments, compareThreeWayCanonicalDocuments } from "@komyaku/diff-engine";
import {
  createDocumentVersion,
  encodeVersionSnapshot,
  findUniqueMergeBase,
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
    assets.push(Object.freeze({ id: value.id, mediaType: value.mediaType, bytes, contentHash: actualHash }));
  }
  return Object.freeze(assets);
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function branchHeads(history) {
  return history.branches.map(({ id, headVersionId }) => [id, headVersionId])
    .sort(([left], [right]) => left.localeCompare(right));
}

export async function loadCompleteLocalVersionHistory(documentId, options = {}) {
  if (!UUID.test(documentId)) throw new Error("invalid_local_document_id");
  let history = await listLocalVersionHistory(documentId, options);
  if (history.available === false) throw new Error("local_version_history_unavailable");
  const initialBranchHeads = branchHeads(history);
  let pageCount = 1;
  while (history.nextCursor) {
    if (history.versions.length >= 5000 || pageCount >= 50) {
      throw new Error("local_history_archive_version_limit");
    }
    const page = await listLocalVersionHistory(documentId, { ...options, cursor: history.nextCursor });
    if (JSON.stringify(branchHeads(page)) !== JSON.stringify(initialBranchHeads)) {
      throw new Error("local_version_history_changed");
    }
    history = appendLocalVersionHistoryPage(history, page);
    pageCount += 1;
  }
  return history;
}

export async function loadLocalHistoryArchiveSource(documentId, {
  concurrency = 4,
  ...options
} = {}) {
  if (!UUID.test(documentId) || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("invalid_local_history_archive_request");
  }
  const history = await loadCompleteLocalVersionHistory(documentId, options);
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

export async function reviewLocalVersionIntegration({ documentId, alternativeBranchId, locale }, options = {}) {
  if (!UUID.test(documentId) || !UUID.test(alternativeBranchId)) {
    throw new Error("invalid_local_merge_review_request");
  }
  const history = await loadCompleteLocalVersionHistory(documentId, options);
  const oursVersionId = history.currentVersionId;
  const alternative = history.branches.find(({ id }) => id === alternativeBranchId);
  if (!UUID.test(oursVersionId) || !history.currentBranchId || !alternative
    || alternative.id === history.currentBranchId) {
    throw new Error("invalid_local_merge_review_branch");
  }
  const theirsVersionId = alternative.headVersionId;
  const baseVersionId = findUniqueMergeBase({ documentId,
    versions: history.versions.map((version) => ({ ...version, documentId })),
    oursVersionId, theirsVersionId });
  const metadata = new Map(history.versions.map((version) => [version.id, version]));
  const ids = [baseVersionId, oursVersionId, theirsVersionId];
  const [base, ours, theirs] = await Promise.all(ids.map((versionId) =>
    loadLocalVersionSnapshot({ documentId, versionId }, options)));
  if ([base, ours, theirs].some((snapshot, index) =>
    snapshot.snapshotHash !== metadata.get(ids[index])?.snapshotHash)) {
    throw new Error("local_merge_review_snapshot_changed");
  }
  const comparison = compareThreeWayCanonicalDocuments(
    base.document, ours.document, theirs.document, { locale });
  const confirmation = await listLocalVersionHistory(documentId, options);
  if (confirmation.currentBranchId !== history.currentBranchId
    || confirmation.currentVersionId !== oursVersionId
    || JSON.stringify(branchHeads(confirmation)) !== JSON.stringify(branchHeads(history))) {
    throw new Error("local_merge_review_changed");
  }
  return Object.freeze({ documentId, currentBranchId: history.currentBranchId,
    oursSnapshotHash: ours.snapshotHash, theirsSnapshotHash: theirs.snapshotHash,
    baseVersionId, oursVersionId, theirsVersionId,
    alternativeBranchId, alternativeBranchName: alternative.name, comparison });
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
  if (input.version.reason === "merge") {
    if (!UUID.test(input.mergeSourceBranchId) || input.mergeSourceBranchId === input.branchId
      || input.version.parentIds.length !== 2
      || input.version.parentIds[0] !== input.expectedHeadVersionId
      || input.version.parentIds[0] === input.version.parentIds[1]
      || !Number.isSafeInteger(input.restoreDraftRevision) || input.restoreDraftRevision < 1) {
      throw new Error("invalid_local_merge_request");
    }
  } else if (input.mergeSourceBranchId != null) {
    throw new Error("invalid_local_merge_request");
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

const integrationCandidates = new WeakMap();

function integrationAssetReview(before, after, verifiedAssets) {
  const verified = new Map(verifiedAssets.map((asset) => [asset.id, asset]));
  const describe = (document, verify = false) => {
    const values = new Map();
    const pending = [...document.content];
    while (pending.length) {
      const node = pending.pop();
      if (["image", "file"].includes(node.type)) {
        if (verify && verified.get(node.assetId)?.mediaType !== node.mediaType) {
          throw new Error("local_merge_asset_media_type_mismatch");
        }
        const entry = values.get(node.assetId) ?? { id: node.assetId, name: node.fileName || node.title || node.altText || node.assetId,
          mediaType: node.mediaType, references: 0 };
        entry.references += 1;
        values.set(node.assetId, entry);
      }
      pending.push(...(node.content ?? []).filter((child) => child?.id));
      pending.push(...(node.caption ?? []).filter((child) => child?.id));
    }
    return values;
  };
  const previous = describe(before);
  const next = describe(after, true);
  return Object.freeze([...new Set([...previous.keys(), ...next.keys()])].sort().map((id) => {
    const asset = verified.get(id);
    const present = next.has(id);
    return Object.freeze({ ...((present ? next : previous).get(id)),
      action: present ? previous.has(id) ? "retained" : "added" : "removed",
      verified: present, mediaType: present ? asset.mediaType : previous.get(id).mediaType,
      byteLength: present ? asset.bytes.byteLength : null,
      contentHash: present ? asset.contentHash : null });
  }));
}

export async function prepareLocalVersionIntegration({ review, choice, document, authorId,
  locale, label = null, now = () => new Date(), idFactory = () => crypto.randomUUID()
}, options = {}) {
  if (!review || !["ours", "theirs"].includes(choice) || document?.id !== review.documentId) {
    throw new Error("invalid_local_merge_candidate");
  }
  const fresh = await reviewLocalVersionIntegration({ documentId: review.documentId,
    alternativeBranchId: review.alternativeBranchId, locale }, options);
  if (["currentBranchId", "baseVersionId", "oursVersionId", "theirsVersionId"].some((key) => fresh[key] !== review[key])) {
    throw new Error("local_merge_review_changed");
  }
  const chosenId = choice === "ours" ? fresh.oursVersionId : fresh.theirsVersionId;
  const chosen = await loadLocalVersionSnapshot({ documentId: review.documentId, versionId: chosenId }, options);
  if (chosen.snapshotHash !== (choice === "ours" ? fresh.oursSnapshotHash : fresh.theirsSnapshotHash)) {
    throw new Error("local_merge_review_snapshot_changed");
  }
  const assets = await loadLocalVersionAssets({ documentId: review.documentId, versionId: chosenId }, options);
  const requiredAssets = new Set(collectAssetIds(chosen.document));
  const availableAssets = new Set(assets.map(({ id }) => id));
  if (requiredAssets.size !== assets.length || availableAssets.size !== assets.length
    || [...requiredAssets].some((id) => !availableAssets.has(id))) {
    throw new Error("local_merge_asset_closure_mismatch");
  }
  const history = await listLocalVersionHistory(review.documentId, options);
  const branch = history.branches.find(({ id }) => id === history.currentBranchId);
  if (!branch || history.currentBranchId !== fresh.currentBranchId
    || history.currentVersionId !== fresh.oursVersionId
    || history.branches.find(({ id }) => id === fresh.alternativeBranchId)?.headVersionId !== fresh.theirsVersionId) {
    throw new Error("local_merge_review_changed");
  }
  const version = await createDocumentVersion({ id: idFactory(), document: chosen.document,
    parentIds: [fresh.oursVersionId, fresh.theirsVersionId], authorId,
    createdAt: now().toISOString(), reason: "merge" });
  const candidate = Object.freeze({ choice, comparison: compareCanonicalDocuments(document, chosen.document, { locale }),
    assetIds: Object.freeze(assets.map(({ id }) => id)), snapshotHash: version.snapshotHash,
    editableParagraphs: editableIntegrationParagraphs(chosen.document),
    assetReview: integrationAssetReview(document, chosen.document, assets) });
  integrationCandidates.set(candidate, { document: chosen.document, locale,
    draftJson: encodeVersionSnapshot(document).json,
    input: { operationId: idFactory(), branchId: branch.id, branchName: branch.name,
      expectedHeadVersionId: fresh.oursVersionId, mergeSourceBranchId: fresh.alternativeBranchId,
      restoreDraftRevision: null, version: { ...version, label } } });
  return candidate;
}

export async function adoptLocalVersionIntegration({ candidate, document, localRevision }, options = {}) {
  const prepared = integrationCandidates.get(candidate);
  if (!prepared || !Number.isSafeInteger(localRevision) || localRevision < 0
    || localRevision >= Number.MAX_SAFE_INTEGER
    || encodeVersionSnapshot(document).json !== prepared.draftJson) {
    throw new Error("local_merge_candidate_changed");
  }
  // Preserve the exact request for receipt replay after an uncertain native response.
  prepared.input.restoreDraftRevision ??= localRevision + 1;
  const receipt = await saveLocalVersion(prepared.input, options);
  return Object.freeze({ receipt, document: prepared.document,
    localRevision: prepared.input.restoreDraftRevision });
}

function editableIntegrationParagraphs(document) {
  const pending = [...document.content].reverse();
  const paragraphs = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === "paragraph" && node.content.length <= 1
      && node.content.every((child) => child.type === "text" && child.marks.length === 0)) {
      paragraphs.push(Object.freeze({ nodeId: node.id, text: node.content[0]?.text ?? "" }));
    }
    pending.push(...[...(node.content ?? []), ...(node.caption ?? [])]
      .filter((child) => child?.id).reverse());
  }
  return Object.freeze(paragraphs);
}

export async function reviseLocalVersionIntegration({ candidate, edits,
  now = () => new Date(), idFactory = () => crypto.randomUUID() }) {
  const prepared = integrationCandidates.get(candidate);
  if (!prepared || prepared.input.restoreDraftRevision !== null || !Array.isArray(edits)
    || edits.length < 1 || edits.length > 100) throw new Error("invalid_local_merge_edits");
  const allowed = new Map(editableIntegrationParagraphs(prepared.document).map((item) => [item.nodeId, item]));
  const updates = new Map();
  for (const edit of edits) {
    if (!edit || Object.keys(edit).some((key) => !["nodeId", "text"].includes(key))
      || !allowed.has(edit.nodeId) || updates.has(edit.nodeId)
      || typeof edit.text !== "string" || edit.text.length > 100_000) {
      throw new Error("invalid_local_merge_edits");
    }
    updates.set(edit.nodeId, edit.text);
  }
  const document = structuredClone(prepared.document);
  const pending = [...document.content];
  while (pending.length) {
    const node = pending.pop();
    if (updates.has(node.id)) {
      const text = updates.get(node.id);
      node.content = text ? [{ ...(node.content[0] ?? { type: "text", marks: [], metadata: {}, extensions: {} }), text }] : [];
    }
    pending.push(...(node.content ?? []).filter((child) => child?.id));
    pending.push(...(node.caption ?? []).filter((child) => child?.id));
  }
  const version = await createDocumentVersion({ ...prepared.input.version, id: idFactory(), document,
    createdAt: now().toISOString() });
  const revised = Object.freeze({ ...candidate, choice: "manual", snapshotHash: version.snapshotHash,
    editableParagraphs: editableIntegrationParagraphs(document),
    comparison: compareCanonicalDocuments(JSON.parse(prepared.draftJson), document, { locale: prepared.locale }) });
  integrationCandidates.set(revised, { ...prepared, document,
    input: { ...prepared.input, operationId: idFactory(), version: { ...version, label: prepared.input.version.label } } });
  return revised;
}

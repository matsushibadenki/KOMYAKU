import { parseCanonicalDocument } from "@komyaku/document-schema";

export const VERSION_ENGINE_STATUS = "local-domain-foundation";
export const VERSION_SNAPSHOT_ENCODING = "canonical-json-v1";
export const MAX_VERSION_SNAPSHOT_BYTES = 12 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_REASONS = new Set(["initial", "named", "restore", "merge", "import"]);

export class VersionEngineError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "VersionEngineError";
    this.code = code;
  }
}

function fail(code) { throw new VersionEngineError(code); }

function assertUuid(value, code) {
  if (typeof value !== "string" || !UUID.test(value)) fail(code);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function encodeVersionSnapshot(document, { maxBytes = MAX_VERSION_SNAPSHOT_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("invalid_snapshot_limit");
  const canonical = parseCanonicalDocument(document);
  const json = JSON.stringify(stableValue(canonical));
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > maxBytes) fail("version_snapshot_too_large");
  return Object.freeze({ canonical, json, bytes });
}

export async function createDocumentVersion({
  id, document, parentIds = [], authorId, createdAt, reason, restoredFromVersionId = null
}) {
  assertUuid(id, "invalid_version_id");
  assertUuid(authorId, "invalid_version_author_id");
  if (!Array.isArray(parentIds) || parentIds.length > 2) fail("invalid_version_parents");
  const uniqueParents = parentIds.map((parentId) => assertUuid(parentId, "invalid_version_parent_id"));
  if (new Set(uniqueParents).size !== uniqueParents.length || uniqueParents.includes(id)) {
    fail("invalid_version_parents");
  }
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    fail("invalid_version_created_at");
  }
  if (!VERSION_REASONS.has(reason)) fail("invalid_version_reason");
  if (reason === "initial" ? uniqueParents.length !== 0 : uniqueParents.length < 1) {
    fail("invalid_version_parents");
  }
  if ((reason === "merge") !== (uniqueParents.length === 2)) fail("invalid_version_parents");
  if (restoredFromVersionId !== null) {
    assertUuid(restoredFromVersionId, "invalid_restored_version_id");
    if (reason !== "restore") fail("invalid_restored_version_id");
  } else if (reason === "restore") fail("invalid_restored_version_id");

  const snapshot = encodeVersionSnapshot(document);
  return Object.freeze({
    id,
    documentId: snapshot.canonical.id,
    schemaVersion: snapshot.canonical.schemaVersion,
    snapshotEncoding: VERSION_SNAPSHOT_ENCODING,
    snapshotJson: snapshot.json,
    snapshotHash: await sha256Hex(snapshot.bytes),
    parentIds: Object.freeze([...uniqueParents]),
    authorId,
    createdAt,
    reason,
    restoredFromVersionId
  });
}

function versionMap(versions, documentId) {
  if (!Array.isArray(versions)) fail("invalid_version_graph");
  const byId = new Map();
  for (const version of versions) {
    if (!version || assertUuid(version.id, "invalid_version_id") !== version.id
      || version.documentId !== documentId || byId.has(version.id)
      || !Array.isArray(version.parentIds) || version.parentIds.length > 2
      || version.parentIds.some((parentId) => !UUID.test(parentId) || parentId === version.id)) {
      fail("invalid_version_graph");
    }
    byId.set(version.id, version);
  }
  return byId;
}

export function validateVersionGraph({ documentId, versions, branches = [] }) {
  assertUuid(documentId, "invalid_document_id");
  const byId = versionMap(versions, documentId);
  for (const version of versions) {
    if (!VERSION_REASONS.has(version.reason)
      || (version.reason === "initial") !== (version.parentIds.length === 0)
      || (version.reason === "merge") !== (version.parentIds.length === 2)
      || (version.reason === "restore") !== (version.restoredFromVersionId !== null)) {
      fail("invalid_version_graph");
    }
    for (const parentId of version.parentIds) {
      if (!byId.has(parentId)) fail("missing_version_parent");
      if (byId.get(parentId).documentId !== version.documentId) fail("cross_document_version_parent");
    }
    if (new Set(version.parentIds).size !== version.parentIds.length) fail("invalid_version_graph");
    if (version.restoredFromVersionId !== null && !byId.has(version.restoredFromVersionId)) {
      fail("missing_restored_version");
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(versionId) {
    if (visiting.has(versionId)) fail("cyclic_version_graph");
    if (visited.has(versionId)) return;
    visiting.add(versionId);
    for (const parentId of byId.get(versionId).parentIds) visit(parentId);
    visiting.delete(versionId);
    visited.add(versionId);
  }
  for (const versionId of byId.keys()) visit(versionId);

  if (!Array.isArray(branches)) fail("invalid_version_graph");
  const branchIds = new Set();
  for (const branch of branches) {
    if (!branch || !UUID.test(branch.id) || branch.documentId !== documentId
      || branchIds.has(branch.id) || !byId.has(branch.headVersionId)
      || typeof branch.name !== "string" || branch.name.trim().length === 0
      || branch.name.length > 200) {
      fail("invalid_version_graph");
    }
    branchIds.add(branch.id);
  }
  return Object.freeze({ versionCount: byId.size, branchCount: branchIds.size });
}

export function createVersionBranch({ id, documentId, name, headVersionId, versions }) {
  assertUuid(id, "invalid_branch_id");
  assertUuid(documentId, "invalid_document_id");
  assertUuid(headVersionId, "invalid_branch_head");
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    fail("invalid_branch_name");
  }
  const byId = versionMap(versions, documentId);
  if (!byId.has(headVersionId)) fail("invalid_branch_head");
  return Object.freeze({ id, documentId, name: name.trim(), headVersionId });
}

export function advanceVersionBranch({ branch, expectedHeadVersionId, nextVersionId, versions }) {
  if (!branch || branch.headVersionId !== expectedHeadVersionId) fail("stale_branch_head");
  const byId = versionMap(versions, branch.documentId);
  const next = byId.get(nextVersionId);
  if (!next || !next.parentIds.includes(expectedHeadVersionId)) fail("invalid_branch_advance");
  return Object.freeze({ ...branch, headVersionId: nextVersionId });
}

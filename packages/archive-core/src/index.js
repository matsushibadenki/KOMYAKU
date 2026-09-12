import { collectAssetIds, parseCanonicalDocument } from "@komyaku/document-schema";
import { z } from "zod";

export const KOMYAKU_ARCHIVE_MEDIA_TYPE = "application/vnd.komyaku.archive+zip";
export const KOMYAKU_ARCHIVE_FORMAT_VERSION = 1;
export const KOMYAKU_HISTORY_ARCHIVE_FORMAT_VERSION = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const uuid = z.string().uuid();
const lowerUuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const assetSchema = z.object({
  id: uuid, mediaType: z.string().min(1).max(200), byteSize: z.number().int().min(1).max(100 * 1024 * 1024),
  sha256: hex, path: z.string().regex(/^assets\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/)
}).strict();
export const archiveManifestSchema = z.object({
  format: z.literal("komyaku-archive"), formatVersion: z.literal(1),
  createdAt: z.string().datetime(), document: z.object({ id: uuid, path: z.string().regex(/^documents\/[0-9a-f-]{36}\.json$/) }).strict(),
  assets: z.array(assetSchema).max(5000), extensions: z.record(z.string(), z.unknown()).default({})
}).strict();

const historyVersionSchema = z.object({
  id: lowerUuid,
  schemaVersion: z.number().int().min(1),
  snapshotEncoding: z.literal("canonical-json-v1"),
  snapshotSha256: hex,
  snapshotByteSize: z.number().int().min(1).max(12 * 1024 * 1024),
  path: z.string().regex(/^versions\/[0-9a-f-]{36}\.json$/),
  parentIds: z.array(lowerUuid).max(2),
  assetIds: z.array(lowerUuid).max(5000),
  authorId: lowerUuid,
  reason: z.enum(["initial", "named", "restore", "merge", "import"]),
  restoredFromVersionId: lowerUuid.nullable(),
  label: z.string().max(1000).nullable(),
  createdAt: z.string().datetime()
}).strict();

const historyBranchSchema = z.object({
  id: lowerUuid,
  name: z.string().min(1).max(200),
  headVersionId: lowerUuid,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const historyArchiveManifestSchema = z.object({
  format: z.literal("komyaku-archive"),
  formatVersion: z.literal(2),
  createdAt: z.string().datetime(),
  document: z.object({
    id: lowerUuid,
    currentBranchId: lowerUuid,
    currentVersionId: lowerUuid
  }).strict(),
  versions: z.array(historyVersionSchema).min(1).max(5000),
  branches: z.array(historyBranchSchema).min(1).max(200),
  assets: z.array(assetSchema.extend({ id: lowerUuid })).max(5000),
  extensions: z.record(z.string(), z.unknown()).default({})
}).strict();

export const HISTORY_ARCHIVE_COLLISION_POLICY = Object.freeze({
  document: "reject-unless-identical-archive-replay",
  version: "reject-any-existing-id",
  branch: "reject-any-existing-id-or-name",
  asset: "deduplicate-only-when-id-media-type-size-and-sha256-match"
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function join(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}
function safePath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 1024
    && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
async function digest(bytes) {
  const value = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function zipStore(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const header = join([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.bytes.byteLength), u32(entry.bytes.byteLength), u16(name.byteLength), u16(0), name]);
    local.push(header, entry.bytes);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.bytes.byteLength), u32(entry.bytes.byteLength), u16(name.byteLength), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.byteLength + entry.bytes.byteLength;
  }
  const directory = join(central);
  return join([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.byteLength), u32(offset), u16(0)]);
}

function readZipStore(bytes, limits) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || bytes.byteLength > limits.maxArchiveBytes) throw new Error("invalid_archive_size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    if (entries.size >= limits.maxEntries || offset + 30 > bytes.byteLength) throw new Error("archive_entry_limit");
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true);
    const compressed = view.getUint32(offset + 18, true);
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags !== 0x0800 || method !== 0 || compressed !== size || size > limits.maxEntryBytes) throw new Error("unsupported_archive_entry");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const end = dataStart + size;
    if (end > bytes.byteLength) throw new Error("truncated_archive_entry");
    const path = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (!safePath(path) || entries.has(path)) throw new Error("unsafe_archive_path");
    const content = bytes.slice(dataStart, end);
    if (crc32(content) !== expectedCrc) throw new Error("archive_crc_mismatch");
    entries.set(path, content);
    offset = end;
  }
  const eocd = bytes.byteLength - 22;
  if (eocd < offset || view.getUint32(eocd, true) !== 0x06054b50
    || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0
    || view.getUint16(eocd + 8, true) !== entries.size || view.getUint16(eocd + 10, true) !== entries.size
    || view.getUint32(eocd + 12, true) !== eocd - offset
    || view.getUint32(eocd + 16, true) !== offset || view.getUint16(eocd + 20, true) !== 0) {
    throw new Error("invalid_archive_directory");
  }
  if (entries.size < 3 || decoder.decode(entries.get("mimetype") ?? new Uint8Array()) !== KOMYAKU_ARCHIVE_MEDIA_TYPE) throw new Error("invalid_archive_mimetype");
  return entries;
}

export async function createKomyakuArchive({ document: input, assets, createdAt = new Date().toISOString() }) {
  const document = parseCanonicalDocument(input);
  const expectedAssetIds = new Set(collectAssetIds(document));
  const seen = new Set();
  const normalized = [];
  for (const asset of assets) {
    if (seen.has(asset.id) || !(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength < 1) throw new Error("invalid_archive_asset");
    seen.add(asset.id);
    const sha256 = await digest(asset.bytes);
    normalized.push({ ...asset, sha256, byteSize: asset.bytes.byteLength, path: `assets/sha256/${sha256.slice(0, 2)}/${sha256}` });
  }
  if (seen.size !== expectedAssetIds.size || [...expectedAssetIds].some((id) => !seen.has(id))) {
    throw new Error("archive_asset_set_mismatch");
  }
  normalized.sort((a, b) => a.id.localeCompare(b.id));
  const documentPath = `documents/${document.id}.json`;
  const manifest = archiveManifestSchema.parse({
    format: "komyaku-archive", formatVersion: 1, createdAt,
    document: { id: document.id, path: documentPath },
    assets: normalized.map(({ id, mediaType, byteSize, sha256, path }) => ({ id, mediaType, byteSize, sha256, path })), extensions: {}
  });
  return zipStore([
    { path: "mimetype", bytes: encoder.encode(KOMYAKU_ARCHIVE_MEDIA_TYPE) },
    { path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest)) },
    { path: documentPath, bytes: encoder.encode(JSON.stringify(document)) },
    ...normalized.map(({ path, bytes }) => ({ path, bytes }))
  ]);
}

export async function verifyKomyakuArchive(bytes, limits = {}) {
  const effective = { maxArchiveBytes: 512 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024, maxEntries: 10_000, ...limits };
  const entries = readZipStore(bytes, effective);
  const manifest = archiveManifestSchema.parse(JSON.parse(decoder.decode(entries.get("manifest.json"))));
  const document = parseCanonicalDocument(JSON.parse(decoder.decode(entries.get(manifest.document.path) ?? new Uint8Array())));
  if (document.id !== manifest.document.id) throw new Error("archive_document_identity_mismatch");
  const documentAssetIds = new Set(collectAssetIds(document));
  if (documentAssetIds.size !== manifest.assets.length
    || manifest.assets.some((asset) => !documentAssetIds.has(asset.id))) throw new Error("archive_asset_set_mismatch");
  for (const asset of manifest.assets) {
    const content = entries.get(asset.path);
    if (!content || content.byteLength !== asset.byteSize || await digest(content) !== asset.sha256
      || asset.path !== `assets/sha256/${asset.sha256.slice(0, 2)}/${asset.sha256}`) throw new Error("archive_asset_integrity_mismatch");
  }
  const archiveDigest = await digest(bytes);
  const assets = manifest.assets.map((asset) => Object.freeze({
    ...asset, bytes: entries.get(asset.path).slice()
  }));
  return Object.freeze({ manifest, document, assets, archiveDigest, byteSize: bytes.byteLength });
}

function uniqueIds(items, error) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(error);
    ids.add(item.id);
  }
  return ids;
}

function validateHistoryGraph(manifest) {
  const versionIds = uniqueIds(manifest.versions, "history_duplicate_version");
  const branchIds = uniqueIds(manifest.branches, "history_duplicate_branch");
  const branchNames = new Set();
  const versionsById = new Map(manifest.versions.map((version) => [version.id, version]));
  for (const version of manifest.versions) {
    if (new Set(version.parentIds).size !== version.parentIds.length
      || version.parentIds.some((parentId) => !versionIds.has(parentId) || parentId === version.id)) {
      throw new Error("history_invalid_parent");
    }
    if (version.reason === "initial" && version.parentIds.length !== 0) {
      throw new Error("history_invalid_initial_version");
    }
    if (version.reason === "merge" && version.parentIds.length !== 2) {
      throw new Error("history_invalid_merge_version");
    }
    if (!["initial", "merge", "import"].includes(version.reason) && version.parentIds.length !== 1) {
      throw new Error("history_invalid_version_parent_count");
    }
    if (version.restoredFromVersionId && !versionIds.has(version.restoredFromVersionId)) {
      throw new Error("history_invalid_restore_reference");
    }
    if (new Set(version.assetIds).size !== version.assetIds.length) {
      throw new Error("history_duplicate_asset_reference");
    }
  }
  const state = new Map();
  const visit = (versionId) => {
    if (state.get(versionId) === "visiting") throw new Error("history_version_cycle");
    if (state.get(versionId) === "visited") return;
    state.set(versionId, "visiting");
    versionsById.get(versionId).parentIds.forEach(visit);
    state.set(versionId, "visited");
  };
  versionIds.forEach(visit);
  for (const branch of manifest.branches) {
    if (!versionIds.has(branch.headVersionId)) throw new Error("history_invalid_branch_head");
    if (branchNames.has(branch.name)) throw new Error("history_duplicate_branch_name");
    branchNames.add(branch.name);
  }
  if (!branchIds.has(manifest.document.currentBranchId)) throw new Error("history_invalid_current_branch");
  const currentBranch = manifest.branches.find(({ id }) => id === manifest.document.currentBranchId);
  if (currentBranch.headVersionId !== manifest.document.currentVersionId) {
    throw new Error("history_current_pointer_mismatch");
  }
  const reachable = new Set();
  const collectReachable = (versionId) => {
    if (reachable.has(versionId)) return;
    reachable.add(versionId);
    versionsById.get(versionId).parentIds.forEach(collectReachable);
  };
  manifest.branches.forEach(({ headVersionId }) => collectReachable(headVersionId));
  if (reachable.size !== versionIds.size) throw new Error("history_unreachable_version");
}

function parseHistorySnapshot(snapshotJson, expectedDocumentId, expectedSchemaVersion) {
  try {
    const document = parseCanonicalDocument(JSON.parse(snapshotJson));
    if (document.id !== expectedDocumentId) throw new Error("history_snapshot_document_mismatch");
    if (document.schemaVersion !== expectedSchemaVersion) throw new Error("history_snapshot_schema_mismatch");
    return document;
  } catch (error) {
    if (error?.message?.startsWith("history_snapshot_")) throw error;
    throw new Error("invalid_history_snapshot");
  }
}

function exactEntrySet(entries, expectedPaths) {
  if (entries.size !== expectedPaths.size
    || [...entries.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error("history_archive_entry_set_mismatch");
  }
}

export async function createKomyakuHistoryArchive({
  documentId, currentBranchId, currentVersionId, versions, branches, assets,
  createdAt = new Date().toISOString()
}) {
  if (!Array.isArray(versions) || !Array.isArray(branches) || !Array.isArray(assets)) {
    throw new Error("invalid_history_archive_input");
  }
  const normalizedVersions = [];
  const requiredAssetIds = new Set();
  let payloadByteSize = 0;
  for (const version of versions) {
    if (typeof version?.snapshotJson !== "string") throw new Error("invalid_history_snapshot");
    const snapshotBytes = encoder.encode(version.snapshotJson);
    if (snapshotBytes.byteLength < 1 || snapshotBytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("invalid_history_snapshot_size");
    }
    payloadByteSize += snapshotBytes.byteLength;
    if (payloadByteSize > 512 * 1024 * 1024) throw new Error("history_archive_size_limit");
    const document = parseHistorySnapshot(version.snapshotJson, documentId, version.schemaVersion);
    const snapshotSha256 = await digest(snapshotBytes);
    if (version.snapshotHash !== undefined && version.snapshotHash !== snapshotSha256) {
      throw new Error("history_snapshot_integrity_mismatch");
    }
    const assetIds = [...new Set(collectAssetIds(document))].sort();
    assetIds.forEach((id) => requiredAssetIds.add(id));
    normalizedVersions.push({
      id: version.id,
      schemaVersion: version.schemaVersion,
      snapshotEncoding: version.snapshotEncoding,
      snapshotSha256,
      snapshotByteSize: snapshotBytes.byteLength,
      path: `versions/${version.id}.json`,
      parentIds: [...version.parentIds],
      assetIds,
      authorId: version.authorId,
      reason: version.reason,
      restoredFromVersionId: version.restoredFromVersionId ?? null,
      label: version.label ?? null,
      createdAt: version.createdAt,
      snapshotBytes
    });
  }
  normalizedVersions.sort((left, right) => left.id.localeCompare(right.id));
  const seenAssets = new Set();
  const normalizedAssets = [];
  for (const asset of assets) {
    if (seenAssets.has(asset?.id) || !(asset?.bytes instanceof Uint8Array)
      || asset.bytes.byteLength < 1 || asset.bytes.byteLength > 100 * 1024 * 1024) {
      throw new Error("invalid_history_archive_asset");
    }
    seenAssets.add(asset.id);
    payloadByteSize += asset.bytes.byteLength;
    if (payloadByteSize > 512 * 1024 * 1024) throw new Error("history_archive_size_limit");
    const sha256 = await digest(asset.bytes);
    normalizedAssets.push({
      id: asset.id,
      mediaType: asset.mediaType,
      byteSize: asset.bytes.byteLength,
      sha256,
      path: `assets/sha256/${sha256.slice(0, 2)}/${sha256}`,
      bytes: asset.bytes
    });
  }
  if (seenAssets.size !== requiredAssetIds.size
    || [...requiredAssetIds].some((assetId) => !seenAssets.has(assetId))) {
    throw new Error("history_archive_asset_set_mismatch");
  }
  normalizedAssets.sort((left, right) => left.id.localeCompare(right.id));
  const sortedBranches = [...branches].sort((left, right) => left.id.localeCompare(right.id));
  const manifest = historyArchiveManifestSchema.parse({
    format: "komyaku-archive",
    formatVersion: KOMYAKU_HISTORY_ARCHIVE_FORMAT_VERSION,
    createdAt,
    document: { id: documentId, currentBranchId, currentVersionId },
    versions: normalizedVersions.map(({ snapshotBytes: _snapshotBytes, ...version }) => version),
    branches: sortedBranches,
    assets: normalizedAssets.map(({ bytes: _bytes, ...asset }) => asset),
    extensions: {}
  });
  validateHistoryGraph(manifest);
  const emittedAssetPaths = new Set();
  const assetEntries = normalizedAssets.filter(({ path }) => {
    if (emittedAssetPaths.has(path)) return false;
    emittedAssetPaths.add(path);
    return true;
  });
  const archive = zipStore([
    { path: "mimetype", bytes: encoder.encode(KOMYAKU_ARCHIVE_MEDIA_TYPE) },
    { path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest)) },
    ...normalizedVersions.map(({ path, snapshotBytes }) => ({ path, bytes: snapshotBytes })),
    ...assetEntries.map(({ path, bytes: content }) => ({ path, bytes: content }))
  ]);
  if (archive.byteLength > 512 * 1024 * 1024) throw new Error("history_archive_size_limit");
  return archive;
}

export async function verifyKomyakuHistoryArchive(bytes, limits = {}) {
  const effective = {
    maxArchiveBytes: 512 * 1024 * 1024,
    maxEntryBytes: 100 * 1024 * 1024,
    maxEntries: 10_002,
    ...limits
  };
  const entries = readZipStore(bytes, effective);
  let manifest;
  try {
    manifest = historyArchiveManifestSchema.parse(
      JSON.parse(decoder.decode(entries.get("manifest.json") ?? new Uint8Array()))
    );
  } catch {
    throw new Error("invalid_history_archive_manifest");
  }
  validateHistoryGraph(manifest);
  const expectedPaths = new Set(["mimetype", "manifest.json",
    ...manifest.versions.map(({ path }) => path), ...manifest.assets.map(({ path }) => path)]);
  exactEntrySet(entries, expectedPaths);
  const manifestAssetIds = new Set(uniqueIds(manifest.assets, "history_duplicate_asset"));
  const requiredAssetIds = new Set();
  const verifiedVersions = [];
  for (const version of manifest.versions) {
    if (version.path !== `versions/${version.id}.json`) throw new Error("history_snapshot_path_mismatch");
    const snapshotBytes = entries.get(version.path);
    if (!snapshotBytes || snapshotBytes.byteLength !== version.snapshotByteSize
      || await digest(snapshotBytes) !== version.snapshotSha256) {
      throw new Error("history_snapshot_integrity_mismatch");
    }
    const snapshotJson = decoder.decode(snapshotBytes);
    const document = parseHistorySnapshot(snapshotJson, manifest.document.id, version.schemaVersion);
    const assetIds = [...new Set(collectAssetIds(document))].sort();
    if (assetIds.length !== version.assetIds.length
      || assetIds.some((assetId, index) => assetId !== version.assetIds[index])
      || assetIds.some((assetId) => !manifestAssetIds.has(assetId))) {
      throw new Error("history_snapshot_asset_set_mismatch");
    }
    assetIds.forEach((assetId) => requiredAssetIds.add(assetId));
    verifiedVersions.push(Object.freeze({
      ...version,
      parentIds: Object.freeze([...version.parentIds]),
      assetIds: Object.freeze([...version.assetIds]),
      snapshotJson,
      snapshotBytes: snapshotBytes.slice(),
      document
    }));
  }
  if (requiredAssetIds.size !== manifestAssetIds.size
    || [...manifestAssetIds].some((assetId) => !requiredAssetIds.has(assetId))) {
    throw new Error("history_archive_asset_set_mismatch");
  }
  const verifiedAssets = [];
  for (const asset of manifest.assets) {
    const content = entries.get(asset.path);
    if (!content || content.byteLength !== asset.byteSize || await digest(content) !== asset.sha256
      || asset.path !== `assets/sha256/${asset.sha256.slice(0, 2)}/${asset.sha256}`) {
      throw new Error("history_archive_asset_integrity_mismatch");
    }
    verifiedAssets.push(Object.freeze({ ...asset, bytes: content.slice() }));
  }
  return Object.freeze({
    kind: "history",
    manifest,
    documentId: manifest.document.id,
    currentBranchId: manifest.document.currentBranchId,
    currentVersionId: manifest.document.currentVersionId,
    versions: Object.freeze(verifiedVersions),
    branches: Object.freeze(manifest.branches.map((branch) => Object.freeze({ ...branch }))),
    assets: Object.freeze(verifiedAssets),
    archiveDigest: await digest(bytes),
    byteSize: bytes.byteLength
  });
}

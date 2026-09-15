import { verifyKomyakuArchive, verifyKomyakuHistoryArchive } from "@komyaku/archive-core";
import { parseCanonicalDocument } from "@komyaku/document-schema";
import { invoke } from "@tauri-apps/api/core";

const MAX_DESKTOP_IMPORT_BYTES = 50 * 1024 * 1024;

export async function verifyLocalKomyakuImport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_DESKTOP_IMPORT_BYTES) {
    throw new Error("invalid_local_archive_size");
  }
  const verified = await verifyKomyakuArchive(bytes, {
    maxArchiveBytes: MAX_DESKTOP_IMPORT_BYTES,
    maxEntryBytes: 1024 * 1024,
    maxEntries: 5000
  });
  return Object.freeze({
    document: verified.document,
    archiveDigest: verified.archiveDigest,
    byteSize: verified.byteSize,
    assetCount: verified.manifest.assets.length,
    formatVersion: verified.manifest.formatVersion
  });
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export class LocalArchiveImportConflictError extends Error {
  constructor(documentId, formatVersion = 1) {
    super("local_archive_document_identity_conflict");
    this.name = "LocalArchiveImportConflictError";
    this.documentId = documentId;
    this.formatVersion = formatVersion;
  }
}

function copyCanonicalDocument(document) {
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = visit(child);
    if (typeof value.id === "string" && typeof value.type === "string") output.id = crypto.randomUUID();
    return output;
  }
  const copied = visit(document);
  copied.metadata = { ...copied.metadata, title: `${copied.metadata.title || "Untitled"} (Copy)` };
  return parseCanonicalDocument(copied);
}

async function materializeLocalSnapshotImport(bytes, {
  invokeImpl = invoke,
  native = isTauriRuntime(),
  now = () => new Date(),
  copy = false
} = {}) {
  const verified = await verifyKomyakuArchive(bytes, {
    maxArchiveBytes: MAX_DESKTOP_IMPORT_BYTES, maxEntryBytes: 1024 * 1024, maxEntries: 5000
  });
  if (!native) return Object.freeze({
    document: verified.document, archiveDigest: verified.archiveDigest,
    byteSize: verified.byteSize, assetCount: verified.assets.length,
    formatVersion: verified.manifest.formatVersion, replayed: false, materialized: false
  });
  const document = copy ? copyCanonicalDocument(verified.document) : verified.document;
  let result;
  try {
    result = await invokeImpl("import_local_komyaku_archive_atomic", { input: {
    archiveDigest: verified.archiveDigest,
    document: {
      documentId: document.id,
      schemaVersion: document.schemaVersion,
      contentJson: JSON.stringify(document),
      localRevision: 1,
      updatedAt: now().toISOString(),
      title: document.metadata.title ?? "",
      language: document.attrs.language,
      direction: document.attrs.direction,
      writingMode: document.attrs.writingMode
    },
    assets: verified.assets.map((asset) => ({
      assetId: asset.id, mediaType: asset.mediaType, contentHash: asset.sha256,
      bytes: Array.from(asset.bytes)
    }))
    } });
  } catch (error) {
    if (error === "local_archive_document_identity_conflict") {
      throw new LocalArchiveImportConflictError(verified.document.id);
    }
    throw error;
  }
  if (!result || result.archiveDigest !== verified.archiveDigest || result.documentId !== document.id
    || result.assetCount !== verified.assets.length || typeof result.replayed !== "boolean"
    || typeof result.contentJson !== "string") throw new Error("invalid_local_archive_materialization_result");
  return Object.freeze({
    document: parseCanonicalDocument(JSON.parse(result.contentJson)),
    archiveDigest: result.archiveDigest, byteSize: verified.byteSize,
    assetCount: result.assetCount, formatVersion: verified.manifest.formatVersion,
    replayed: result.replayed, materialized: true
  });
}

async function materializeVerifiedLocalHistoryImport(verified, {
  invokeImpl = invoke,
  native = isTauriRuntime(),
  now = () => new Date()
} = {}) {
  const current = verified.versions.find(({ id }) => id === verified.currentVersionId);
  if (!current) throw new Error("invalid_local_history_archive");
  const document = parseCanonicalDocument(JSON.parse(current.snapshotJson));
  if (!native) return Object.freeze({
    document, archiveDigest: verified.archiveDigest, byteSize: verified.byteSize,
    assetCount: verified.assets.length, versionCount: verified.versions.length,
    branchCount: verified.branches.length, formatVersion: 2, replayed: false,
    materialized: false
  });
  let result;
  try {
    result = await invokeImpl("import_local_history_archive_atomic", { input: {
      archiveDigest: verified.archiveDigest,
      importedAt: now().toISOString(),
      document: {
        documentId: document.id,
        schemaVersion: document.schemaVersion,
        contentJson: current.snapshotJson,
        localRevision: 1,
        updatedAt: current.createdAt,
        title: document.metadata.title ?? "",
        language: document.attrs.language,
        direction: document.attrs.direction,
        writingMode: document.attrs.writingMode
      },
      currentBranchId: verified.currentBranchId,
      currentVersionId: verified.currentVersionId,
      versions: verified.versions.map((version) => ({
        id: version.id,
        documentId: verified.documentId,
        schemaVersion: version.schemaVersion,
        snapshotEncoding: version.snapshotEncoding,
        snapshotJson: version.snapshotJson,
        snapshotHash: version.snapshotSha256,
        parentIds: [...version.parentIds],
        authorId: version.authorId,
        reason: version.reason,
        restoredFromVersionId: version.restoredFromVersionId,
        label: version.label,
        createdAt: version.createdAt
      })),
      branches: verified.branches.map((branch) => ({ ...branch })),
      assets: verified.assets.map((asset) => ({
        assetId: asset.id,
        mediaType: asset.mediaType,
        contentHash: asset.sha256,
        bytes: Array.from(asset.bytes)
      }))
    } });
  } catch (error) {
    if (error === "local_archive_document_identity_conflict") {
      throw new LocalArchiveImportConflictError(verified.documentId, 2);
    }
    throw error;
  }
  if (!result || result.archiveDigest !== verified.archiveDigest
    || result.documentId !== verified.documentId
    || result.currentBranchId !== verified.currentBranchId
    || result.currentVersionId !== verified.currentVersionId
    || result.versionCount !== verified.versions.length
    || result.branchCount !== verified.branches.length
    || result.assetCount !== verified.assets.length
    || typeof result.replayed !== "boolean" || result.contentJson !== current.snapshotJson) {
    throw new Error("invalid_local_history_materialization_result");
  }
  return Object.freeze({
    document: parseCanonicalDocument(JSON.parse(result.contentJson)),
    archiveDigest: result.archiveDigest,
    byteSize: verified.byteSize,
    assetCount: result.assetCount,
    versionCount: result.versionCount,
    branchCount: result.branchCount,
    formatVersion: 2,
    replayed: result.replayed,
    materialized: true
  });
}

export async function materializeLocalHistoryImport(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_DESKTOP_IMPORT_BYTES) {
    throw new Error("invalid_local_archive_size");
  }
  const verified = await verifyKomyakuHistoryArchive(bytes, {
    maxArchiveBytes: MAX_DESKTOP_IMPORT_BYTES,
    maxEntryBytes: 1024 * 1024,
    maxEntries: 10001
  });
  return materializeVerifiedLocalHistoryImport(verified, options);
}

export async function materializeLocalKomyakuImport(bytes, options = {}) {
  if (!options.copy) {
    let history = null;
    try {
      history = await verifyKomyakuHistoryArchive(bytes, {
        maxArchiveBytes: MAX_DESKTOP_IMPORT_BYTES,
        maxEntryBytes: 1024 * 1024,
        maxEntries: 10001
      });
    } catch {}
    if (history) return materializeVerifiedLocalHistoryImport(history, options);
  }
  return materializeLocalSnapshotImport(bytes, options);
}

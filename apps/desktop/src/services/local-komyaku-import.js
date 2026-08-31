import { verifyKomyakuArchive } from "@komyaku/archive-core";

const MAX_DESKTOP_IMPORT_BYTES = 50 * 1024 * 1024;

export async function verifyLocalKomyakuImport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_DESKTOP_IMPORT_BYTES) {
    throw new Error("invalid_local_archive_size");
  }
  const verified = await verifyKomyakuArchive(bytes, {
    maxArchiveBytes: MAX_DESKTOP_IMPORT_BYTES,
    maxEntryBytes: 25 * 1024 * 1024,
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

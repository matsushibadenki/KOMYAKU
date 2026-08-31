import { collectAssetIds, parseCanonicalDocument } from "@komyaku/document-schema";
import { z } from "zod";

export const KOMYAKU_ARCHIVE_MEDIA_TYPE = "application/vnd.komyaku.archive+zip";
export const KOMYAKU_ARCHIVE_FORMAT_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const uuid = z.string().uuid();
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
  return Object.freeze({ manifest, document, archiveDigest, byteSize: bytes.byteLength });
}

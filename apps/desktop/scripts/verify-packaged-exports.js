import { Database } from "bun:sqlite";
import { verifyKomyakuArchive } from "@komyaku/archive-core";
import { encodeVersionSnapshot } from "@komyaku/version-engine";
import { renderLocalDocumentExport } from "../src/services/local-document-export.js";

const [databasePath, documentId, textPath, markdownPath, archivePath] = process.argv.slice(2);
if (!databasePath || !documentId || !textPath || !markdownPath || !archivePath) {
  throw new Error("Usage: bun scripts/verify-packaged-exports.js DB DOCUMENT_ID TXT MD KOMYAKU");
}
const db = new Database(databasePath, { readonly: true });
try {
  const draft = db.query("SELECT content_json FROM local_drafts WHERE document_id = ?").get(documentId);
  const version = db.query(`SELECT v.snapshot_json, v.snapshot_hash FROM local_document_versions v
    JOIN local_documents d ON d.current_version_id = v.id WHERE d.id = ?`).get(documentId);
  if (!draft || !version) throw new Error("qa_document_or_version_missing");
  const canonical = JSON.parse(draft.content_json);
  for (const [format, path] of [["txt", textPath], ["md", markdownPath]]) {
    const actual = new Uint8Array(await Bun.file(path).arrayBuffer());
    const expected = renderLocalDocumentExport(canonical, format).bytes;
    if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(`qa_${format}_bytes_mismatch`);
  }
  const verified = await verifyKomyakuArchive(new Uint8Array(await Bun.file(archivePath).arrayBuffer()));
  const archived = encodeVersionSnapshot(verified.document);
  const saved = encodeVersionSnapshot(JSON.parse(version.snapshot_json));
  const hash = new Bun.CryptoHasher("sha256").update(saved.bytes).digest("hex");
  if (hash !== version.snapshot_hash || archived.json !== saved.json) throw new Error("qa_version_snapshot_mismatch");
  console.log(JSON.stringify({ status: "verified", documentId, formats: ["txt", "md", "komyaku-v1"],
    archiveDigest: verified.archiveDigest, assetCount: verified.assets.length,
    scope: "draft text bytes and current Version Canonical content; native Asset bytes not compared" }));
} finally {
  db.close();
}

import { parseCanonicalDocument } from "@komyaku/document-schema";
import { cloudApiClient } from "./cloud-api.js";

const MAX_CLOUD_IMPORT_BYTES = 50 * 1024 * 1024;

export async function materializeCloudKomyakuImport({ token, workspaceId, bytes }) {
  if (!token || !workspaceId || !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1 || bytes.byteLength > MAX_CLOUD_IMPORT_BYTES) {
    throw new Error("invalid_cloud_archive_import");
  }
  const result = await cloudApiClient.importKomyakuArchive({ token, workspaceId, bytes });
  if (!result || typeof result.importId !== "string" || typeof result.archiveDigest !== "string"
    || typeof result.replayed !== "boolean" || !Number.isSafeInteger(result.assetCount)) {
    throw new Error("invalid_cloud_archive_import_response");
  }
  return Object.freeze({ ...result, document: parseCanonicalDocument(result.document) });
}

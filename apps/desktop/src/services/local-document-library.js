import { invoke } from "@tauri-apps/api/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function parseLocalDocumentSummaries(value) {
  if (!Array.isArray(value) || value.length > 200) throw new Error("invalid_local_document_library");
  const ids = new Set();
  return Object.freeze(value.map((item) => {
    if (!item || !UUID.test(item.documentId) || ids.has(item.documentId)
      || typeof item.title !== "string" || item.title.length > 1000
      || typeof item.defaultLanguage !== "string"
      || !Number.isSafeInteger(item.localRevision) || item.localRevision < 0
      || typeof item.updatedAt !== "string"
      || !(item.archivedAt == null || typeof item.archivedAt === "string")
      || !(item.archiveDigest == null || /^[0-9a-f]{64}$/.test(item.archiveDigest))) {
      throw new Error("invalid_local_document_library");
    }
    ids.add(item.documentId);
    return Object.freeze({ ...item });
  }));
}

export async function listLocalDocuments({ invokeImpl = invoke, native = isTauriRuntime() } = {}) {
  if (!native) return Object.freeze([]);
  return parseLocalDocumentSummaries(await invokeImpl("list_local_documents"));
}

export async function mutateLocalDocument({ documentId, title, archived }, {
  invokeImpl = invoke, native = isTauriRuntime(), now = () => new Date()
} = {}) {
  if (!native || !UUID.test(documentId) || (title === undefined && archived === undefined)
    || (title !== undefined && (typeof title !== "string" || title.length > 1000))
    || (archived !== undefined && typeof archived !== "boolean")) {
    throw new Error("invalid_local_document_mutation");
  }
  const result = await invokeImpl("mutate_local_document_atomic", { input: {
    documentId, title: title ?? null, archived: archived ?? null, updatedAt: now().toISOString()
  } });
  return parseLocalDocumentSummaries([result])[0];
}

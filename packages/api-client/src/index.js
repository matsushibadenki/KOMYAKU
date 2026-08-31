export class ApiClientError extends Error {
  constructor(code, { status = 0, retryAfterSeconds = null, reference = null } = {}) {
    super(code);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.reference = reference;
  }
}

async function responseValue(response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (response.status === 204) return null;
  if (!contentType.toLowerCase().includes("application/json")) return null;
  return response.json();
}

async function checked(response) {
  const value = await responseValue(response);
  if (response.ok) return value;
  throw new ApiClientError(value?.error ?? "request_failed", {
    status: response.status,
    retryAfterSeconds: Number(response.headers.get("Retry-After")) || null,
    reference: typeof value?.importId === "string" ? value.importId : null
  });
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function assetInspection(value, { expectedNodeId, expectedFileName } = {}) {
  const statuses = new Set(["pending", "inspecting", "accepted", "rejected", "error"]);
  if (!value || typeof value.assetId !== "string" || !statuses.has(value.inspectionStatus)
    || typeof value.mediaType !== "string" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 1
    || (expectedNodeId !== undefined && (value.nodeId !== expectedNodeId || typeof value.referenceId !== "string"))) {
    throw new ApiClientError("invalid_asset_inspection_response");
  }
  if (expectedFileName !== undefined && value.fileName !== expectedFileName) {
    throw new ApiClientError("invalid_asset_inspection_response");
  }
  if (value.inspectionStatus === "accepted") {
    const validPng = value.detectedMediaType === "image/png"
      && value.policyVersion === "decoder-backed-png-v1"
      && Number.isSafeInteger(value.width) && value.width > 0
      && Number.isSafeInteger(value.height) && value.height > 0;
    const validFile = value.detectedMediaType === value.mediaType
      && value.policyVersion === "baseline-signature-v1"
      && value.width == null && value.height == null;
    if (!validPng && !validFile) throw new ApiClientError("invalid_asset_inspection_response");
  }
  return value;
}

export function createApiClient({ baseUrl, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/+$/, "");
  return Object.freeze({
    async health() {
      return checked(await fetchImpl(`${root}/health`));
    },

    async login({ email, password }) {
      return checked(await fetchImpl(`${root}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }));
    },

    async session(token) {
      return checked(await fetchImpl(`${root}/auth/session`, { headers: bearer(token) }));
    },

    async workspaces(token) {
      return checked(await fetchImpl(`${root}/auth/workspaces`, { headers: bearer(token) }));
    },

    async logout(token) {
      return checked(await fetchImpl(`${root}/auth/logout`, {
        method: "POST", headers: bearer(token)
      }));
    },

    async importConversation({ token, workspaceId, bytes, sourceProvider, idempotencyKey }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/conversation-imports`,
        {
          method: "POST",
          headers: {
            ...bearer(token),
            "Content-Type": "application/json; charset=utf-8",
            "Idempotency-Key": idempotencyKey,
            "X-KOMYAKU-Source-Provider": sourceProvider
          },
          body: bytes
        }
      ));
    },

    async aiProviderConnections({ token, workspaceId }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/ai-provider-connections`,
        { headers: bearer(token) }
      ));
    },

    async acceptedPngPreview({ token, workspaceId, assetId }) {
      const response = await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/preview.png`,
        { headers: bearer(token) }
      );
      if (!response.ok) return checked(response);
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
      const policyVersion = response.headers.get("X-KOMYAKU-Inspection-Policy");
      const width = Number(response.headers.get("X-KOMYAKU-Image-Width"));
      const height = Number(response.headers.get("X-KOMYAKU-Image-Height"));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (contentType !== "image/png" || policyVersion !== "decoder-backed-png-v1"
        || !Number.isSafeInteger(width) || width < 1
        || !Number.isSafeInteger(height) || height < 1
        || bytes.byteLength < 1 || bytes.byteLength > 256 * 1024) {
        throw new ApiClientError("invalid_png_preview_response", { status: response.status });
      }
      return {
        bytes,
        inspection: {
          status: "accepted", detectedMediaType: "image/png",
          byteSize: bytes.byteLength, width, height, policyVersion
        }
      };
    },

    async uploadPngAsset({ token, workspaceId, documentId, nodeId, bytes }) {
      const value = await checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/assets`,
        {
          method: "POST",
          headers: {
            ...bearer(token),
            "Content-Type": "image/png",
            "X-KOMYAKU-Node-ID": nodeId,
            "X-KOMYAKU-Document-ID": documentId
          },
          body: bytes
        }
      ));
      return assetInspection(value, { expectedNodeId: nodeId });
    },

    async uploadFileAsset({ token, workspaceId, documentId, nodeId, fileName, mediaType, bytes }) {
      const value = await checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/file-assets`,
        {
          method: "POST",
          headers: {
            ...bearer(token),
            "Content-Type": mediaType,
            "X-KOMYAKU-Node-ID": nodeId,
            "X-KOMYAKU-Document-ID": documentId,
            "X-KOMYAKU-File-Name": encodeURIComponent(fileName)
          },
          body: bytes
        }
      ));
      return assetInspection(value, { expectedNodeId: nodeId, expectedFileName: fileName });
    },

    async assetInspection({ token, workspaceId, assetId }) {
      return assetInspection(await checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/inspection`,
        { headers: bearer(token) }
      )));
    },

    async releaseAssetReference({ token, workspaceId, assetId, referenceId }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/references/${encodeURIComponent(referenceId)}`,
        { method: "DELETE", headers: bearer(token) }
      ));
    },

    async reconcileDocumentAssets({ token, workspaceId, documentId, revision, references }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/asset-checkpoint`,
        {
          method: "PUT",
          headers: { ...bearer(token), "Content-Type": "application/json" },
          body: JSON.stringify({ revision, references })
        }
      ));
    },

    async createVerifiedDocumentExport({ token, workspaceId, documentId, document }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/exports`,
        {
          method: "POST",
          headers: { ...bearer(token), "Content-Type": "application/json" },
          body: JSON.stringify(document)
        }
      ));
    },

    async verifiedDocumentExports({ token, workspaceId, documentId }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/exports`,
        { headers: bearer(token) }
      ));
    },

    async verifiedDocumentExportDownload({ token, workspaceId, documentId, artifactId }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/exports/${encodeURIComponent(artifactId)}/download-url`,
        { headers: bearer(token) }
      ));
    },

    async invalidateVerifiedDocumentExport({ token, workspaceId, documentId, artifactId }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/exports/${encodeURIComponent(artifactId)}`,
        { method: "DELETE", headers: bearer(token) }
      ));
    },

    async persistAiHandoff({
      token, workspaceId, conversationId, confirmed, responseMessage,
      providerResponseId = null, completedAt, idempotencyKey
    }) {
      return checked(await fetchImpl(
        `${root}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/ai-handoffs`,
        {
          method: "POST",
          headers: {
            ...bearer(token),
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify({ confirmed, responseMessage, providerResponseId, completedAt })
        }
      ));
    }
  });
}

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

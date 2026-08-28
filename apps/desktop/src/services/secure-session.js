import { invoke } from "@tauri-apps/api/core";

export class SecureSessionError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "SecureSessionError";
    this.code = code;
  }
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function boundedCode(error) {
  return typeof error === "string" && /^[a-z0-9_]+$/.test(error)
    ? error
    : "secure_session_unavailable";
}

export function createSecureSessionStore({ invokeImpl = invoke, available = isTauriRuntime } = {}) {
  return Object.freeze({
    async load() {
      if (!available()) return null;
      try {
        return await invokeImpl("load_cloud_session");
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    },
    async save(token) {
      if (!available()) throw new SecureSessionError("secure_session_unavailable");
      try {
        await invokeImpl("store_cloud_session", { token });
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    },
    async clear() {
      if (!available()) return;
      try {
        await invokeImpl("delete_cloud_session");
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    }
  });
}

export const secureSessionStore = createSecureSessionStore();

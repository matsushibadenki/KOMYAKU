import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime, SecureSessionError } from "./secure-session.js";

function boundedCode(error) {
  return typeof error === "string" && /^[a-z0-9_]+$/.test(error)
    ? error
    : "provider_credential_unavailable";
}

export function createProviderCredentialStore({ invokeImpl = invoke, available = isTauriRuntime } = {}) {
  return Object.freeze({
    async load(reference) {
      if (!available()) return null;
      try {
        return await invokeImpl("load_provider_credential", { reference });
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    },
    async save(reference, secret) {
      if (!available()) throw new SecureSessionError("provider_credential_unavailable");
      try {
        await invokeImpl("store_provider_credential", { reference, secret });
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    },
    async clear(reference) {
      if (!available()) return;
      try {
        await invokeImpl("delete_provider_credential", { reference });
      } catch (error) {
        throw new SecureSessionError(boundedCode(error), { cause: error });
      }
    }
  });
}

export const providerCredentialStore = createProviderCredentialStore();

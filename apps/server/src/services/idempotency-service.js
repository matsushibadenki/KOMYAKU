import { v7 as uuidv7 } from "uuid";
import { createIdempotencyHasher } from "../security/idempotency-keys.js";

export class IdempotencyError extends Error {
  constructor(code) { super(code); this.name = "IdempotencyError"; this.code = code; }
}

export function createIdempotencyService({ repository, secret, ttlSeconds = 86_400, now = () => new Date() }) {
  if (!repository?.acquire || !repository?.complete || !repository?.fail) {
    throw new Error("Idempotency repository is required");
  }
  const hasher = createIdempotencyHasher(secret);
  return Object.freeze({
    async execute({ scope, key, requestBytes, operation }) {
      if (typeof scope !== "string" || scope.length < 1 || scope.length > 200) {
        throw new IdempotencyError("invalid_idempotency_scope");
      }
      if (typeof key !== "string" || key.length < 8 || key.length > 200) {
        throw new IdempotencyError("invalid_idempotency_key");
      }
      if (!(requestBytes instanceof Uint8Array)) throw new IdempotencyError("invalid_request_fingerprint");
      const keyHash = await hasher.key(scope, key);
      const requestHash = await hasher.request(requestBytes);
      const expiresAt = new Date(now().getTime() + ttlSeconds * 1000).toISOString();
      const acquired = await repository.acquire({
        id: uuidv7(), scope, keyHash, requestHash, expiresAt
      });
      if (!acquired.acquired) {
        if (acquired.record.requestHash !== requestHash) {
          throw new IdempotencyError("idempotency_key_reused");
        }
        if (acquired.record.status === "completed") {
          return {
            replayed: true,
            status: acquired.record.responseStatus,
            reference: acquired.record.responseReference
          };
        }
        throw new IdempotencyError(
          acquired.record.status === "processing" ? "idempotency_in_progress" : "idempotency_failed"
        );
      }
      try {
        const result = await operation();
        if (!Number.isInteger(result?.status) || typeof result?.reference !== "string") {
          throw new Error("Idempotent operation must return status and reference");
        }
        await repository.complete({
          scope, keyHash, requestHash,
          responseStatus: result.status, responseReference: result.reference
        });
        return { replayed: false, ...result };
      } catch (error) {
        await repository.fail({ scope, keyHash, requestHash });
        throw error;
      }
    }
  });
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createIdempotencyHasher(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Idempotency secret must contain at least 32 characters");
  }
  let keyPromise;
  const key = () => keyPromise ??= crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return Object.freeze({
    async key(scope, idempotencyKey) {
      const digest = await crypto.subtle.sign(
        "HMAC", await key(), new TextEncoder().encode(`${scope}\u0000${idempotencyKey}`)
      );
      return hex(digest);
    },
    async request(bytes) {
      return hex(await crypto.subtle.digest("SHA-256", bytes));
    }
  });
}

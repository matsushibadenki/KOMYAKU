export function createRateLimitKeyHasher(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Rate limit key secret must contain at least 32 characters");
  }

  let keyPromise;
  function key() {
    keyPromise ??= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return keyPromise;
  }

  return async function hashRateLimitKey(scope, identifier) {
    if (typeof scope !== "string" || scope.length === 0) throw new Error("Rate limit scope is required");
    if (typeof identifier !== "string" || identifier.length === 0) {
      throw new Error("Rate limit identifier is required");
    }
    const digest = await crypto.subtle.sign(
      "HMAC",
      await key(),
      new TextEncoder().encode(`${scope}\u0000${identifier}`)
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

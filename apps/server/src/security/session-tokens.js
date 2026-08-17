const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function createOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return base64Url(bytes);
}

export async function hashOpaqueToken(token) {
  if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid session token format");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const createSessionToken = createOpaqueToken;
export const hashSessionToken = hashOpaqueToken;

export function readBearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

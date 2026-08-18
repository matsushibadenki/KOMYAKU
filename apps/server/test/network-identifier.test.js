import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createNetworkIdentifierResolver } from "../src/security/network-identifier.js";

async function resolve({ forwarded, remote = "192.0.2.10", trustedProxyHops = 0 }) {
  let value;
  const resolver = createNetworkIdentifierResolver({
    trustedProxyHops,
    getRemoteAddress: () => remote
  });
  const app = new Hono();
  app.get("/", (context) => {
    value = resolver(context);
    return context.text("ok");
  });
  await app.request("/", { headers: forwarded ? { "X-Forwarded-For": forwarded } : {} });
  return value;
}

describe("network rate-limit identity", () => {
  test("ignores spoofable forwarding headers when no proxy is trusted", async () => {
    expect(await resolve({ forwarded: "203.0.113.8" })).toBe("192.0.2.10");
  });

  test("selects the client address from the trusted right side of the chain", async () => {
    expect(await resolve({
      forwarded: "203.0.113.8, 198.51.100.20",
      trustedProxyHops: 2
    })).toBe("203.0.113.8");
    expect(await resolve({
      forwarded: "spoofed, 198.51.100.20",
      trustedProxyHops: 1
    })).toBe("198.51.100.20");
  });

  test("fails closed to a shared identity when no valid address exists", async () => {
    expect(await resolve({ remote: null })).toBe("unknown-network");
  });
});

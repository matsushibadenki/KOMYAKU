import { isIP } from "node:net";

function validAddress(value) {
  const address = value?.trim();
  return address && isIP(address) ? address.toLowerCase() : null;
}

export function createNetworkIdentifierResolver({ getRemoteAddress, trustedProxyHops = 0 }) {
  if (typeof getRemoteAddress !== "function") throw new Error("Remote address reader is required");
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error("Trusted proxy hops must be a nonnegative integer");
  }

  return function resolveNetworkIdentifier(context) {
    const remote = validAddress(getRemoteAddress(context));
    if (trustedProxyHops === 0) return remote ?? "unknown-network";

    const forwarded = context.req.header("X-Forwarded-For")
      ?.split(",")
      .map(validAddress)
      .filter(Boolean) ?? [];
    const index = forwarded.length - trustedProxyHops;
    return (index >= 0 ? forwarded[index] : null) ?? remote ?? "unknown-network";
  };
}

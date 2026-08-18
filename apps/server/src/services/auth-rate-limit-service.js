import { createRateLimitKeyHasher } from "../security/rate-limit-keys.js";

export const AUTH_RATE_LIMIT_POLICIES = Object.freeze({
  loginIdentifier: Object.freeze({ scope: "login:identifier", limit: 5, windowSeconds: 900, blockSeconds: 900 }),
  loginNetwork: Object.freeze({ scope: "login:network", limit: 30, windowSeconds: 900, blockSeconds: 900 }),
  registerNetwork: Object.freeze({ scope: "register:network", limit: 10, windowSeconds: 3600, blockSeconds: 3600 }),
  verificationIdentifier: Object.freeze({ scope: "verification:identifier", limit: 5, windowSeconds: 3600, blockSeconds: 3600 }),
  verificationNetwork: Object.freeze({ scope: "verification:network", limit: 60, windowSeconds: 3600, blockSeconds: 3600 }),
  resetIdentifier: Object.freeze({ scope: "reset:identifier", limit: 5, windowSeconds: 3600, blockSeconds: 3600 }),
  resetNetwork: Object.freeze({ scope: "reset:network", limit: 30, windowSeconds: 3600, blockSeconds: 3600 })
});

export function createAuthRateLimitService({ repository, secret }) {
  if (!repository?.consume) throw new Error("Authentication rate limit repository is required");
  const hashKey = createRateLimitKeyHasher(secret);

  return Object.freeze({
    async consume(policyName, identifier) {
      const policy = AUTH_RATE_LIMIT_POLICIES[policyName];
      if (!policy) throw new Error(`Unknown authentication rate limit policy: ${policyName}`);
      const keyHash = await hashKey(policy.scope, identifier);
      return repository.consume({ ...policy, keyHash });
    },

    async clear(policyName, identifier) {
      const policy = AUTH_RATE_LIMIT_POLICIES[policyName];
      if (!policy) throw new Error(`Unknown authentication rate limit policy: ${policyName}`);
      const keyHash = await hashKey(policy.scope, identifier);
      await repository.clear({ scope: policy.scope, keyHash });
    }
  });
}

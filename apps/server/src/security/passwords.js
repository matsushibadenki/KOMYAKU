export const PASSWORD_POLICY = Object.freeze({
  minimumCodePoints: 15,
  maximumCodePoints: 1024,
  algorithm: "argon2id",
  memoryCostKiB: 19_456,
  timeCost: 2
});

export function assertAcceptablePassword(password) {
  if (typeof password !== "string") throw new TypeError("Password must be a string");
  const length = Array.from(password).length;
  if (length < PASSWORD_POLICY.minimumCodePoints) {
    throw new Error(`Password must contain at least ${PASSWORD_POLICY.minimumCodePoints} characters`);
  }
  if (length > PASSWORD_POLICY.maximumCodePoints) {
    throw new Error(`Password must contain at most ${PASSWORD_POLICY.maximumCodePoints} characters`);
  }
  return password;
}

export function createPasswordHasher(passwordApi = Bun.password) {
  if (!passwordApi?.hash || !passwordApi?.verify) throw new Error("Password hashing API is required");

  return Object.freeze({
    async hash(password) {
      assertAcceptablePassword(password);
      return passwordApi.hash(password, {
        algorithm: PASSWORD_POLICY.algorithm,
        memoryCost: PASSWORD_POLICY.memoryCostKiB,
        timeCost: PASSWORD_POLICY.timeCost
      });
    },

    async verify(password, passwordHash) {
      if (typeof password !== "string" || typeof passwordHash !== "string") return false;
      try {
        return await passwordApi.verify(password, passwordHash);
      } catch {
        return false;
      }
    }
  });
}

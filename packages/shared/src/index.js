export const AI_TRAINING_POLICIES = Object.freeze({
  DENY: "deny",
  ALLOW: "allow"
});

export const DEFAULT_AI_TRAINING_POLICY = AI_TRAINING_POLICIES.DENY;

export function parseAiTrainingPolicy(value) {
  return value === AI_TRAINING_POLICIES.ALLOW
    ? AI_TRAINING_POLICIES.ALLOW
    : DEFAULT_AI_TRAINING_POLICY;
}


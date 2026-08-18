import { z } from "zod";

export const ENTITLEMENT_KEYS = Object.freeze({
  LOCAL_DOCUMENTS: "document.local.unlimited",
  LOCAL_VERSION_GRAPH: "version.graph.local",
  BASIC_DIFF: "diff.basic",
  BRANCHING: "version.branch",
  BASIC_EXPORT: "export.basic",
  CLOUD_SYNC: "sync.cloud",
  WEB_ACCESS: "web.access",
  CLOUD_STORAGE_BYTES: "storage.cloud_bytes",
  CLOUD_CONVERSATION_IMPORT: "conversation.import.cloud",
  LONG_TERM_HISTORY_SEARCH: "history.search.long_term",
  SEMANTIC_DIFF: "diff.semantic",
  MANAGED_AI: "ai.handoff.managed",
  MONTHLY_AI_CREDITS: "ai.monthly_credits",
  GIT_SYNC: "git.sync",
  ADVANCED_EXPORT: "export.advanced",
  REALTIME_COLLABORATION: "collaboration.realtime",
  REVIEW_WORKFLOW: "review.workflow",
  WORKSPACE_PERMISSIONS: "workspace.permissions",
  AUDIT_LOG: "audit.log",
  SAML_SSO: "sso.saml",
  SCIM: "identity.scim",
  IMMUTABLE_ARCHIVE: "archive.immutable",
  VERSION_API: "api.versions"
});

const localCore = Object.freeze({
  [ENTITLEMENT_KEYS.LOCAL_DOCUMENTS]: true,
  [ENTITLEMENT_KEYS.LOCAL_VERSION_GRAPH]: true,
  [ENTITLEMENT_KEYS.BASIC_DIFF]: true,
  [ENTITLEMENT_KEYS.BRANCHING]: true,
  [ENTITLEMENT_KEYS.BASIC_EXPORT]: true
});

const GB = 1024 ** 3;
const plan = (code, displayNameKey, entitlements) => Object.freeze({
  code, displayNameKey, status: "active", entitlements: Object.freeze({ ...localCore, ...entitlements })
});

export const PLAN_CATALOG_VERSION = "2026-08-18";
export const PLAN_CATALOG = Object.freeze({
  local: plan("local", "plans.local.name", {}),
  free: plan("free", "plans.free.name", {
    [ENTITLEMENT_KEYS.CLOUD_SYNC]: true,
    [ENTITLEMENT_KEYS.WEB_ACCESS]: true,
    [ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES]: 1 * GB,
    [ENTITLEMENT_KEYS.CLOUD_CONVERSATION_IMPORT]: true,
    [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 0
  }),
  personal: plan("personal", "plans.personal.name", {
    [ENTITLEMENT_KEYS.CLOUD_SYNC]: true,
    [ENTITLEMENT_KEYS.WEB_ACCESS]: true,
    [ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES]: 50 * GB,
    [ENTITLEMENT_KEYS.CLOUD_CONVERSATION_IMPORT]: true,
    [ENTITLEMENT_KEYS.LONG_TERM_HISTORY_SEARCH]: true,
    [ENTITLEMENT_KEYS.SEMANTIC_DIFF]: true,
    [ENTITLEMENT_KEYS.MANAGED_AI]: true,
    [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 100
  }),
  pro: plan("pro", "plans.pro.name", {
    [ENTITLEMENT_KEYS.CLOUD_SYNC]: true,
    [ENTITLEMENT_KEYS.WEB_ACCESS]: true,
    [ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES]: 200 * GB,
    [ENTITLEMENT_KEYS.CLOUD_CONVERSATION_IMPORT]: true,
    [ENTITLEMENT_KEYS.LONG_TERM_HISTORY_SEARCH]: true,
    [ENTITLEMENT_KEYS.SEMANTIC_DIFF]: true,
    [ENTITLEMENT_KEYS.MANAGED_AI]: true,
    [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 500,
    [ENTITLEMENT_KEYS.GIT_SYNC]: true,
    [ENTITLEMENT_KEYS.ADVANCED_EXPORT]: true,
    [ENTITLEMENT_KEYS.VERSION_API]: true
  }),
  team: plan("team", "plans.team.name", {
    [ENTITLEMENT_KEYS.CLOUD_SYNC]: true,
    [ENTITLEMENT_KEYS.WEB_ACCESS]: true,
    [ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES]: 200 * GB,
    [ENTITLEMENT_KEYS.CLOUD_CONVERSATION_IMPORT]: true,
    [ENTITLEMENT_KEYS.LONG_TERM_HISTORY_SEARCH]: true,
    [ENTITLEMENT_KEYS.SEMANTIC_DIFF]: true,
    [ENTITLEMENT_KEYS.MANAGED_AI]: true,
    [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 500,
    [ENTITLEMENT_KEYS.ADVANCED_EXPORT]: true,
    [ENTITLEMENT_KEYS.REALTIME_COLLABORATION]: true,
    [ENTITLEMENT_KEYS.REVIEW_WORKFLOW]: true,
    [ENTITLEMENT_KEYS.WORKSPACE_PERMISSIONS]: true,
    [ENTITLEMENT_KEYS.AUDIT_LOG]: true,
    [ENTITLEMENT_KEYS.VERSION_API]: true
  }),
  enterprise: plan("enterprise", "plans.enterprise.name", {
    [ENTITLEMENT_KEYS.CLOUD_SYNC]: true,
    [ENTITLEMENT_KEYS.WEB_ACCESS]: true,
    [ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES]: 200 * GB,
    [ENTITLEMENT_KEYS.CLOUD_CONVERSATION_IMPORT]: true,
    [ENTITLEMENT_KEYS.LONG_TERM_HISTORY_SEARCH]: true,
    [ENTITLEMENT_KEYS.SEMANTIC_DIFF]: true,
    [ENTITLEMENT_KEYS.MANAGED_AI]: true,
    [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 500,
    [ENTITLEMENT_KEYS.GIT_SYNC]: true,
    [ENTITLEMENT_KEYS.ADVANCED_EXPORT]: true,
    [ENTITLEMENT_KEYS.REALTIME_COLLABORATION]: true,
    [ENTITLEMENT_KEYS.REVIEW_WORKFLOW]: true,
    [ENTITLEMENT_KEYS.WORKSPACE_PERMISSIONS]: true,
    [ENTITLEMENT_KEYS.AUDIT_LOG]: true,
    [ENTITLEMENT_KEYS.SAML_SSO]: true,
    [ENTITLEMENT_KEYS.SCIM]: true,
    [ENTITLEMENT_KEYS.IMMUTABLE_ARCHIVE]: true,
    [ENTITLEMENT_KEYS.VERSION_API]: true
  })
});

const valueSchema = z.union([z.boolean(), z.number().nonnegative(), z.string().max(1000)]);
const overrideSchema = z.record(z.string().min(1).max(200), valueSchema);

export function resolveEntitlements({ planCode = "free", subscription = {}, workspace = {}, contract = {} } = {}) {
  const selectedPlan = PLAN_CATALOG[planCode];
  if (!selectedPlan) throw new Error(`Unknown plan code: ${planCode}`);
  const values = Object.freeze({
    ...selectedPlan.entitlements,
    ...overrideSchema.parse(subscription),
    ...overrideSchema.parse(workspace),
    ...overrideSchema.parse(contract)
  });
  return Object.freeze({
    catalogVersion: PLAN_CATALOG_VERSION,
    planCode,
    values,
    can(key) { return values[key] === true; },
    limit(key) { return typeof values[key] === "number" ? values[key] : null; },
    value(key) { return values[key] ?? null; }
  });
}

export function localCoreEntitlements() {
  return Object.freeze({ ...localCore });
}

import { describe, expect, test } from "bun:test";
import {
  ENTITLEMENT_KEYS,
  PLAN_CATALOG,
  localCoreEntitlements,
  resolveEntitlements
} from "../src/index.js";

describe("provider-independent entitlement catalog", () => {
  test("keeps local writing, history, branching, diff, and export in every plan", () => {
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.entitlements[ENTITLEMENT_KEYS.LOCAL_DOCUMENTS]).toBe(true);
      expect(plan.entitlements[ENTITLEMENT_KEYS.LOCAL_VERSION_GRAPH]).toBe(true);
      expect(plan.entitlements[ENTITLEMENT_KEYS.BASIC_DIFF]).toBe(true);
      expect(plan.entitlements[ENTITLEMENT_KEYS.BRANCHING]).toBe(true);
      expect(plan.entitlements[ENTITLEMENT_KEYS.BASIC_EXPORT]).toBe(true);
    }
    expect(localCoreEntitlements()).not.toHaveProperty(ENTITLEMENT_KEYS.CLOUD_SYNC);
  });

  test("uses storage capacity rather than version-count limits", () => {
    const free = resolveEntitlements({ planCode: "free" });
    const personal = resolveEntitlements({ planCode: "personal" });
    const pro = resolveEntitlements({ planCode: "pro" });
    expect(free.limit(ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES)).toBe(1024 ** 3);
    expect(personal.limit(ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES)).toBe(50 * 1024 ** 3);
    expect(pro.limit(ENTITLEMENT_KEYS.CLOUD_STORAGE_BYTES)).toBe(200 * 1024 ** 3);
    expect(Object.keys(free.values).some((key) => key.includes("version_count"))).toBe(false);
  });

  test("applies subscription, workspace, then contract overrides", () => {
    const resolved = resolveEntitlements({
      planCode: "free",
      subscription: { [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 10 },
      workspace: { [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 20 },
      contract: { [ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS]: 30, [ENTITLEMENT_KEYS.SAML_SSO]: true }
    });
    expect(resolved.limit(ENTITLEMENT_KEYS.MONTHLY_AI_CREDITS)).toBe(30);
    expect(resolved.can(ENTITLEMENT_KEYS.SAML_SSO)).toBe(true);
  });

  test("contains no prices or payment-provider identifiers", () => {
    const serialized = JSON.stringify(PLAN_CATALOG).toLowerCase();
    expect(serialized).not.toContain("stripe");
    expect(serialized).not.toContain("price_id");
    expect(serialized).not.toContain("monthly_price");
  });
});

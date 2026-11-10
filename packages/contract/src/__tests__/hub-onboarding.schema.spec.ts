/**
 * ROK-2153 N4: a `claim-character` dismissal can carry a scope (a provider's
 * dismissal round, e.g. a BG3 campaign). Stored as `<key>:<scope>` in a
 * `varchar(64)` column, so the scope is bounded and colon-free.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  HUB_ONBOARDING_KEYS,
  HUB_ONBOARDING_SCOPED_KEYS,
  HubOnboardingDismissScopeSchema,
  HubOnboardingDismissalSchema,
  HubOnboardingScopeQuerySchema,
  isHubOnboardingScopedKey,
} from "../hub-onboarding.schema.js";

const row = { key: "claim-character", guildId: 7, dismissedAt: "2026-11-10T00:00:00.000Z" };

describe("HubOnboardingDismissScopeSchema", () => {
  it("accepts a bounded token", () => {
    expect(HubOnboardingDismissScopeSchema.safeParse("campaign-1").success).toBe(true);
    expect(HubOnboardingDismissScopeSchema.safeParse("x".repeat(40)).success).toBe(true);
  });

  it.each([["empty", ""], ["41 chars", "x".repeat(41)], ["a colon", "a:b"], ["a space", "x y"]])(
    "rejects %s",
    (_label, scope) => {
      expect(HubOnboardingDismissScopeSchema.safeParse(scope).success).toBe(false);
    },
  );

  it("fits the key column: 'claim-character:' + 40 <= 64", () => {
    expect("claim-character:".length + 40).toBeLessThanOrEqual(64);
  });
});

describe("HubOnboardingDismissalSchema", () => {
  it("parses a row without scope as before", () => {
    const parsed = HubOnboardingDismissalSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("scope");
  });

  it("parses a scoped row and rejects a bad scope", () => {
    const ok = HubOnboardingDismissalSchema.safeParse({ ...row, scope: "campaign-1" });
    expect(ok.data?.scope).toBe("campaign-1");
    expect(HubOnboardingDismissalSchema.safeParse({ ...row, scope: "a:b" }).success).toBe(false);
  });
});

describe("HubOnboardingScopeQuerySchema", () => {
  it("accepts guildId with scope, and guildId alone as before", () => {
    const scoped = HubOnboardingScopeQuerySchema.safeParse({ guildId: "7", scope: "campaign-1" });
    expect(scoped.data).toEqual({ guildId: 7, scope: "campaign-1" });
    expect(HubOnboardingScopeQuerySchema.safeParse({ guildId: "7" }).data).toEqual({ guildId: 7 });
    expect(HubOnboardingScopeQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects scope without guildId", () => {
    expect(HubOnboardingScopeQuerySchema.safeParse({ scope: "campaign-1" }).success).toBe(false);
  });

  it("rejects a malformed scope", () => {
    for (const scope of ["", "x".repeat(41), "a:b"]) {
      expect(HubOnboardingScopeQuerySchema.safeParse({ guildId: "7", scope }).success).toBe(false);
    }
  });
});

describe("scoped keys", () => {
  it("are a subset of the known keys and only claim-character", () => {
    for (const k of HUB_ONBOARDING_SCOPED_KEYS) expect(HUB_ONBOARDING_KEYS).toContain(k);
    expect([...HUB_ONBOARDING_SCOPED_KEYS]).toEqual(["claim-character"]);
  });

  it("rejects scope for every other key", () => {
    const others = HUB_ONBOARDING_KEYS.filter((k) => k !== "claim-character");
    expect(others.length).toBeGreaterThan(0);
    for (const k of others) expect(isHubOnboardingScopedKey(k)).toBe(false);
    expect(isHubOnboardingScopedKey("claim-character")).toBe(true);
  });
});

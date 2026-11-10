/**
 * ROK-2153 S1: the generic hub claim contract — candidate, status, request,
 * result, error codes — plus the `claim-character` onboarding key and the
 * `claim-provider` behaviour kind.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  HUB_CLAIM_ERROR_CODES,
  HUB_CLAIM_ERROR_STATUS,
  HubClaimCandidateIdSchema,
  HubClaimCandidateSchema,
  HubClaimErrorCodeSchema,
  HubClaimRequestSchema,
  HubClaimResultSchema,
  HubClaimStatusSchema,
  MAX_HUB_CLAIM_CANDIDATES,
  type HubClaimCandidate,
  type HubClaimStatus,
} from "../hub-claim.schema.js";
import { HubOnboardingKeySchema } from "../hub-onboarding.schema.js";
import { HubBehaviourKindSchema } from "../plugin-hub-manifest.schema.js";

function candidate(over: Partial<HubClaimCandidate> = {}): HubClaimCandidate {
  return {
    id: "4821",
    name: "Thrall",
    subtitle: "Lv 60 Shaman",
    avatarUrl: null,
    detailPath: "/characters/abc",
    match: null,
    matchReason: null,
    ...over,
  };
}

function nCandidates(n: number): HubClaimCandidate[] {
  return Array.from({ length: n }, (_, i) => candidate({ id: `c${i}` }));
}

function status(over: Partial<HubClaimStatus> = {}): HubClaimStatus {
  return {
    provider: "valheim",
    viewerIsMember: true,
    viewerHasClaim: false,
    unclaimedCount: 1,
    suggested: null,
    candidates: [candidate()],
    truncated: false,
    claimOptions: "none",
    ...over,
  };
}

const strong = candidate({
  id: "s1",
  match: "strong",
  matchReason: "addon_guid",
});

describe("HubClaimCandidateIdSchema", () => {
  it.each([
    "12:Generic:Human:1",
    "4821",
    "0b6f3c1e-9d1a-4c3e-8f20-5a1b2c3d4e5f",
  ])("accepts %s", (id) => {
    expect(HubClaimCandidateIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["a.b", "..x", "v1.2:slot"])("accepts dotted id %s", (id) => {
    expect(HubClaimCandidateIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([["a/b"], [""], ["x".repeat(201)], ["."], [".."], ["..."]])(
    "rejects %j",
    (id) => {
      expect(HubClaimCandidateIdSchema.safeParse(id).success).toBe(false);
    },
  );
});

describe("HubClaimCandidateSchema", () => {
  it("accepts a list-only candidate and a strong match", () => {
    expect(HubClaimCandidateSchema.safeParse(candidate()).success).toBe(true);
    expect(HubClaimCandidateSchema.safeParse(strong).success).toBe(true);
  });

  it("is strict — an extra key is rejected", () => {
    const r = HubClaimCandidateSchema.safeParse({ ...candidate(), extra: 1 });
    expect(r.success).toBe(false);
  });

  it("rejects match without matchReason, and matchReason without match", () => {
    const a = candidate({ match: "possible", matchReason: null });
    const b = candidate({ match: null, matchReason: "same_name" });
    expect(HubClaimCandidateSchema.safeParse(a).success).toBe(false);
    expect(HubClaimCandidateSchema.safeParse(b).success).toBe(false);
  });

  it.each(["/characters/12", "/hubs/3?tab=members", "/", "/a#b"])(
    "detailPath accepts site path %j",
    (detailPath) => {
      const r = HubClaimCandidateSchema.safeParse(candidate({ detailPath }));
      expect(r.success).toBe(true);
    },
  );

  it.each([
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "//evil.com",
    "/a b",
    "/x\\y",
    "https://evil.com",
  ])("detailPath rejects %j (open redirect)", (detailPath) => {
    const r = HubClaimCandidateSchema.safeParse(candidate({ detailPath }));
    expect(r.success).toBe(false);
  });

  it.each([
    "https://cdn.discordapp.com/avatars/1/a.png",
    "https://render.worldofwarcraft.com/a.jpg?x=1",
    "/api/hub-media/7/avatar.png",
  ])("avatarUrl accepts %j", (avatarUrl) => {
    const r = HubClaimCandidateSchema.safeParse(candidate({ avatarUrl }));
    expect(r.success).toBe(true);
  });

  it.each([
    "http://cdn.example/a.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//evil.com/a.png",
    "/\\evil.com/a.png",
    "https:///a.png",
    "https://evil.com/a b.png",
    "a.png",
  ])("avatarUrl rejects %j", (avatarUrl) => {
    const r = HubClaimCandidateSchema.safeParse(candidate({ avatarUrl }));
    expect(r.success).toBe(false);
  });

  it("pins the field limits", () => {
    const bad = [
      candidate({ name: "" }),
      candidate({ name: "n".repeat(101) }),
      candidate({ subtitle: "s".repeat(161) }),
      candidate({ avatarUrl: "a".repeat(501) }),
      candidate({ detailPath: "characters/abc" }),
      candidate({ detailPath: "//evil.example/x" }),
      candidate({ detailPath: `/${"p".repeat(300)}` }),
    ];
    for (const c of bad) {
      expect(
        HubClaimCandidateSchema.safeParse(c).success,
        JSON.stringify(c),
      ).toBe(false);
    }
  });
});

describe("HubClaimStatusSchema", () => {
  it("accepts a list-only status and a suggested strong match", () => {
    expect(HubClaimStatusSchema.safeParse(status()).success).toBe(true);
    const s = status({
      suggested: strong,
      candidates: [strong, candidate()],
      unclaimedCount: 2,
    });
    expect(HubClaimStatusSchema.safeParse(s).success).toBe(true);
  });

  it("is strict — an extra key is rejected", () => {
    expect(
      HubClaimStatusSchema.safeParse({ ...status(), extra: true }).success,
    ).toBe(false);
  });

  it(`caps candidates at ${MAX_HUB_CLAIM_CANDIDATES}`, () => {
    const at = status({ candidates: nCandidates(50), unclaimedCount: 50 });
    const over = status({ candidates: nCandidates(51), unclaimedCount: 51 });
    expect(MAX_HUB_CLAIM_CANDIDATES).toBe(50);
    expect(HubClaimStatusSchema.safeParse(at).success).toBe(true);
    expect(HubClaimStatusSchema.safeParse(over).success).toBe(false);
  });

  it("rejects a suggested candidate missing from candidates", () => {
    const s = status({ suggested: strong, candidates: [candidate()] });
    expect(HubClaimStatusSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a suggested candidate that is only a possible match", () => {
    const possible = candidate({
      id: "p1",
      match: "possible",
      matchReason: "same_name",
    });
    const s = status({ suggested: possible, candidates: [possible] });
    expect(HubClaimStatusSchema.safeParse(s).success).toBe(false);
  });

  it("rejects more candidates than unclaimedCount", () => {
    const s = status({ candidates: nCandidates(2), unclaimedCount: 1 });
    expect(HubClaimStatusSchema.safeParse(s).success).toBe(false);
  });

  it("requires truncated to match unclaimedCount > candidates.length", () => {
    const cut = status({
      candidates: nCandidates(50),
      unclaimedCount: 60,
      truncated: true,
    });
    const lies = status({
      candidates: nCandidates(50),
      unclaimedCount: 60,
      truncated: false,
    });
    const falseCut = status({ truncated: true });
    expect(HubClaimStatusSchema.safeParse(cut).success).toBe(true);
    expect(HubClaimStatusSchema.safeParse(lies).success).toBe(false);
    expect(HubClaimStatusSchema.safeParse(falseCut).success).toBe(false);
  });

  it("rejects a negative unclaimedCount and an unknown claimOptions", () => {
    const neg = {
      ...status({ candidates: [], unclaimedCount: 0 }),
      unclaimedCount: -1,
    };
    expect(HubClaimStatusSchema.safeParse(neg).success).toBe(false);
    const opt = { ...status(), claimOptions: "bg3_party" };
    expect(HubClaimStatusSchema.safeParse(opt).success).toBe(false);
  });
});

describe("HubClaimRequestSchema / HubClaimResultSchema", () => {
  it("accepts an empty body and an options record; rejects non-record options and extras", () => {
    expect(HubClaimRequestSchema.safeParse({}).success).toBe(true);
    expect(
      HubClaimRequestSchema.safeParse({ options: { ruleset: "hardcore" } })
        .success,
    ).toBe(true);
    expect(HubClaimRequestSchema.safeParse({ options: 3 }).success).toBe(false);
    expect(HubClaimRequestSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("accepts a result with and without a characters row; is strict", () => {
    const base = {
      claimed: candidate(),
      becameMember: true,
      characterId: null,
    };
    expect(HubClaimResultSchema.safeParse(base).success).toBe(true);
    expect(
      HubClaimResultSchema.safeParse({ ...base, characterId: "abc" }).success,
    ).toBe(true);
    expect(HubClaimResultSchema.safeParse({ ...base, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("error codes, onboarding key, behaviour kind", () => {
  it("maps every error code to its HTTP status", () => {
    expect(Object.keys(HUB_CLAIM_ERROR_STATUS).sort()).toEqual(
      [...HUB_CLAIM_ERROR_CODES].sort(),
    );
    expect(HUB_CLAIM_ERROR_STATUS).toEqual({
      HUB_CLAIM_UNAVAILABLE: 404,
      HUB_CLAIM_CANDIDATE_GONE: 404,
      HUB_CLAIM_CANDIDATE_TAKEN: 409,
      HUB_CLAIM_VIEWER_HAS_CLAIM: 409,
      HUB_CLAIM_BAD_OPTIONS: 400,
      HUB_CLAIM_FORBIDDEN: 403,
    });
    expect(HubClaimErrorCodeSchema.safeParse("slot_taken").success).toBe(false);
  });

  it("accepts the claim-character onboarding key and the claim-provider kind", () => {
    expect(HubOnboardingKeySchema.parse("claim-character")).toBe(
      "claim-character",
    );
    expect(HubBehaviourKindSchema.parse("claim-provider")).toBe(
      "claim-provider",
    );
  });
});

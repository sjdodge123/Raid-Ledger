import { describe, expect, it } from "vitest";
import { CharacterSchema } from "../characters.schema.js";
import {
  WowRosterMemberCharacterSchema,
  WowRosterMemberClaimedSchema,
  WowRosterMemberResponseSchema,
} from "../wow-roster-member-character.schema.js";

/** ROK-2149 AC-16 — the roster-member payload is strict and additive. */
const member = {
  id: "roster-member:42",
  userId: null,
  gameId: 3,
  name: "Thrall",
  realm: null,
  class: "Shaman",
  spec: null,
  role: null,
  roleOverride: null,
  effectiveRole: null,
  isMain: false,
  itemLevel: null,
  externalId: null,
  avatarUrl: null,
  renderUrl: null,
  level: 12,
  race: null,
  faction: null,
  lastSyncedAt: null,
  profileUrl: null,
  region: "us",
  ruleset: null,
  gameVariant: "wow_forever",
  equipment: null,
  talents: null,
  professions: null,
  professionsSource: null,
  hasManualProfessions: false,
  displayOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  readOnly: true,
  rosterMemberId: 42,
  hubId: 7,
  canClaim: true,
  noArmoryReason: "pending",
};

describe("WowRosterMemberCharacterSchema", () => {
  it("parses a claim-preview payload without roster-only keys", () => {
    const parsed = WowRosterMemberCharacterSchema.parse(member);
    expect("rank" in parsed).toBe(false);
    expect("lastSeen" in parsed).toBe(false);
  });

  it("parses the members audience payload with rank and lastSeen", () => {
    const full = {
      ...member,
      rank: { index: 2, name: "Officer" },
      lastSeen: { online: false, lastOnlineDays: 3 },
    };
    expect(WowRosterMemberCharacterSchema.parse(full).rank?.name).toBe(
      "Officer",
    );
  });

  it("rejects unknown keys (strict) — e.g. a staff-only linkedAccount", () => {
    const r = WowRosterMemberCharacterSchema.safeParse({
      ...member,
      linkedAccount: { userId: 1 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a characters uuid as id and a numeric userId", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(
      WowRosterMemberCharacterSchema.safeParse({ ...member, id: uuid }).success,
    ).toBe(false);
    expect(
      WowRosterMemberCharacterSchema.safeParse({ ...member, userId: 1 })
        .success,
    ).toBe(false);
  });

  it("is never accepted as a real CharacterDto", () => {
    expect(CharacterSchema.safeParse(member).success).toBe(false);
  });
});

describe("WowRosterMemberResponseSchema", () => {
  it("accepts the claimed redirect shape and rejects extra keys on it", () => {
    const claimed = {
      claimedCharacterId: "11111111-1111-4111-8111-111111111111",
      rosterMemberId: 42,
      hubId: 7,
    };
    expect(WowRosterMemberResponseSchema.safeParse(claimed).success).toBe(true);
    expect(
      WowRosterMemberClaimedSchema.safeParse({ ...claimed, name: "x" }).success,
    ).toBe(false);
  });
});

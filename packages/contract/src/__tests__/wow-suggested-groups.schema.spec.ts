/**
 * ROK-2212 — the Suggested groups read: query defaults, the member key ↔
 * characterId/memberId refinement, the 5-member group and strictness.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  SuggestedGroupMemberSchema,
  SuggestedGroupSchema,
  SuggestedGroupsQuerySchema,
  SuggestedGroupsSchema,
} from '../wow-suggested-groups.schema.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const claimed = {
  key: UUID,
  characterId: UUID,
  memberId: 7,
  userId: 3,
  name: 'Thrall',
  class: 'Shaman',
  level: 30,
  role: 'healer' as const,
};

const unclaimed = {
  key: 'm42',
  characterId: null,
  memberId: 42,
  userId: null,
  name: 'Jaina',
  class: null,
  level: 31,
  role: 'dps' as const,
};

const group = {
  instance: { id: 491, name: 'Razorfen Kraul', minimumLevel: 29, maximumLevel: 38 },
  members: [
    { ...claimed, role: 'tank' as const },
    claimed,
    unclaimed,
    unclaimed,
    unclaimed,
  ],
  levelSpread: 1,
  sharedQuests: null,
};

describe('SuggestedGroupsQuerySchema', () => {
  it('defaults scope to top and coerces instanceId', () => {
    expect(SuggestedGroupsQuerySchema.parse({})).toEqual({ scope: 'top' });
    expect(SuggestedGroupsQuerySchema.parse({ scope: 'all', instanceId: '491' })).toEqual({
      scope: 'all',
      instanceId: 491,
    });
  });

  it('rejects an unknown scope, a non-positive instanceId and extra keys', () => {
    expect(SuggestedGroupsQuerySchema.safeParse({ scope: 'mine' }).success).toBe(false);
    expect(SuggestedGroupsQuerySchema.safeParse({ instanceId: '0' }).success).toBe(false);
    expect(SuggestedGroupsQuerySchema.safeParse({ guildId: '1' }).success).toBe(false);
  });
});

describe('SuggestedGroupMemberSchema key refinement', () => {
  it('accepts a claimed member keyed by its characterId and an unclaimed one keyed m<memberId>', () => {
    expect(SuggestedGroupMemberSchema.safeParse(claimed).success).toBe(true);
    expect(SuggestedGroupMemberSchema.safeParse(unclaimed).success).toBe(true);
  });

  it('rejects a claimed member whose key is not its characterId', () => {
    const r = SuggestedGroupMemberSchema.safeParse({ ...claimed, key: 'm7' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("A claimed member's key is its characterId");
  });

  it('rejects an unclaimed member keyed by anything but m<memberId>, or with no memberId', () => {
    for (const bad of [{ ...unclaimed, key: 'm43' }, { ...unclaimed, memberId: null }]) {
      const r = SuggestedGroupMemberSchema.safeParse(bad);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("An unclaimed member's key is m<memberId>");
    }
  });

  it('rejects an unknown role and extra keys', () => {
    expect(SuggestedGroupMemberSchema.safeParse({ ...claimed, role: 'support' }).success).toBe(false);
    expect(SuggestedGroupMemberSchema.safeParse({ ...claimed, spec: 'resto' }).success).toBe(false);
  });
});

describe('SuggestedGroupSchema / SuggestedGroupsSchema', () => {
  it('needs exactly five members', () => {
    expect(SuggestedGroupSchema.safeParse(group).success).toBe(true);
    expect(SuggestedGroupSchema.safeParse({ ...group, members: group.members.slice(0, 4) }).success).toBe(false);
  });

  it('parses a full response with pool counts and an offset datetime', () => {
    const dto = {
      groups: [group],
      pool: { tank: 1, healer: 1, dps: 3, unclaimed: 3, skippedNoRole: 1, skippedNoLevel: 0 },
      generatedAt: '2026-11-17T12:00:00.000Z',
    };
    expect(SuggestedGroupsSchema.parse(dto)).toEqual(dto);
    expect(SuggestedGroupsSchema.safeParse({ ...dto, pool: { ...dto.pool, extra: 1 } }).success).toBe(false);
  });
});

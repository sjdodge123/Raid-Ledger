/**
 * ROK-2352 L1 — LFG group identity on the wire: the opaque group-key grammar
 * (mirrors the `lfg_intents.group_key` CHECK), the `?group=` queries and the
 * additive fields on the existing LFG schemas.
 */
import { describe, expect, it } from 'vitest';
import {
  LFG_ANY_GROUP_KEY,
  LFG_GROUP_KEY_PATTERN,
  LfgDeleteGroupQuerySchema,
  LfgGroupKeySchema,
  LfgGroupQuerySchema,
  LfgGroupRefSchema,
} from '../lfg-groups.schema.js';
import { LfgGroupListResponseSchema } from '../lfg-group-list.schema.js';
import {
  CreateLfgIntentSchema,
  LfgClearOfferSchema,
  LfgGroupDetailSchema,
  LfgGroupSummarySchema,
  LfgHeartedGameSchema,
  LfgIntentSchema,
} from '../lfg.schema.js';

const summary = {
  gameId: 9, gameName: 'WoW', gameSlug: 'world-of-warcraft-classic', gameCoverUrl: null,
  activeCount: 2, nowCount: 0, state: 'lfm', viabilityThreshold: null, isViable: false,
  hasOwnIntent: true, soonestExpiresAt: null, soonestNowExpiresAt: null, playingNow: null,
};

describe('LfgGroupKeySchema — the group_key CHECK grammar', () => {
  it.each(['', 'dungeon:36', 'raid:409', 'dungeon:36:heroic', 'a:B_9-x'])('accepts %j', (k) => {
    expect(LfgGroupKeySchema.safeParse(k).success).toBe(true);
  });
  it.each([
    'Dungeon:36', 'dungeon:', ':36', 'dungeon', 'dungeon:36 x', '9raid:1', 'raid:a.b',
    `${'a'.repeat(33)}:1`, `raid:${'1'.repeat(65)}`,
  ])('rejects %j', (k) => {
    expect(LfgGroupKeySchema.safeParse(k).success).toBe(false);
  });
  it('accepts the longest legal prefix and suffix', () => {
    expect(LfgGroupKeySchema.safeParse(`${'a'.repeat(32)}:${'1'.repeat(64)}`).success).toBe(true);
  });
  it('exposes the DB CHECK pattern verbatim and "" as the whole-game group', () => {
    expect(LFG_GROUP_KEY_PATTERN.source).toBe('^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9:_-]{1,64}$');
    expect(LFG_ANY_GROUP_KEY).toBe('');
  });
});

describe('?group= queries', () => {
  it('defaults an absent group to the whole-game group', () => {
    expect(LfgGroupQuerySchema.parse({})).toEqual({ group: '' });
    expect(LfgGroupQuerySchema.parse({ group: 'raid:409' })).toEqual({ group: 'raid:409' });
  });
  it('rejects "*" on reads but accepts it on DELETE (all my hands in the game)', () => {
    expect(LfgGroupQuerySchema.safeParse({ group: '*' }).success).toBe(false);
    expect(LfgDeleteGroupQuerySchema.parse({ group: '*' })).toEqual({ group: '*' });
    expect(LfgDeleteGroupQuerySchema.safeParse({ group: 'Bad' }).success).toBe(false);
  });
});

describe('CreateLfgIntentSchema groupKey + handDetail (additive)', () => {
  it('stays valid without the new fields', () => {
    expect(CreateLfgIntentSchema.parse({ gameId: 1 })).toEqual({ gameId: 1, urgency: 'week' });
  });
  it('accepts a keyed hand with an adapter-validated detail', () => {
    const r = CreateLfgIntentSchema.parse({
      gameId: 1, groupKey: 'dungeon:36', handDetail: { roles: ['tank'] },
    });
    expect(r.groupKey).toBe('dungeon:36');
    expect(r.handDetail).toEqual({ roles: ['tank'] });
  });
  it('rejects a groupKey that breaks the grammar', () => {
    const r = CreateLfgIntentSchema.safeParse({ gameId: 1, groupKey: 'DUNGEON:36' });
    expect(r.error?.issues[0]?.path).toEqual(['groupKey']);
  });
});

describe('response schemas carry the group (additive)', () => {
  it('summary: groupKey, groupLabel, groupCount optional and validated', () => {
    expect(LfgGroupSummarySchema.parse(summary)).toEqual(summary);
    const keyed = { ...summary, groupKey: 'raid:409', groupLabel: 'Molten Core', groupCount: 3 };
    expect(LfgGroupSummarySchema.parse(keyed)).toEqual(keyed);
    expect(LfgGroupSummarySchema.safeParse({ ...summary, groupCount: -1 }).success).toBe(false);
  });
  it('detail lists the caller\'s other groups as refs', () => {
    const detail = {
      ...summary, members: [], ownIntent: null, threadId: null, convertedEvent: null,
      ownOtherGroups: [{ groupKey: 'dungeon:36', groupLabel: 'Deadmines' }],
    };
    expect(LfgGroupDetailSchema.parse(detail).ownOtherGroups).toEqual(detail.ownOtherGroups);
    expect(LfgGroupRefSchema.safeParse({ groupKey: 'x', groupLabel: 'X' }).success).toBe(false);
  });
  it('intent, hearted game and clear offer accept a groupKey', () => {
    const intent = {
      id: 1, userId: 2, gameId: 3, status: 'active', visibility: 'local', createdAt: 'a',
      expiresAt: 'b', urgency: 'now', ttlMinutes: 30, convertedToPollId: null,
      convertedToEventId: null, groupKey: 'dungeon:36',
    };
    expect(LfgIntentSchema.parse(intent).groupKey).toBe('dungeon:36');
    const hearted = { gameId: 1, gameName: 'g', gameSlug: 's', gameCoverUrl: null, heartedAt: 'a', activeCount: 0 };
    expect(LfgHeartedGameSchema.parse({ ...hearted, groupKey: '' }).groupKey).toBe('');
    const offer = { gameId: 1, gameName: 'g', gameCoverUrl: null, intentId: 1, eventId: 2, playedAt: 'a' };
    expect(LfgClearOfferSchema.parse({ ...offer, groupKey: 'raid:1' }).groupKey).toBe('raid:1');
    expect(LfgClearOfferSchema.safeParse({ ...offer, groupKey: 'nope' }).success).toBe(false);
  });
});

describe('LfgGroupListResponseSchema — GET /lfg/:gameId/groups', () => {
  it('parses an Any group and a raid group with a roster shape and coverage', () => {
    const body = {
      gameId: 9,
      groups: [
        { ...summary, groupKey: '', groupLabel: null, kind: 'any' },
        {
          ...summary, groupKey: 'raid:409', groupLabel: 'Molten Core', kind: 'raid', size: 40,
          rosterShape: { tank: 4, healer: 10, dps: 26 }, levelRange: [60, 60],
          coverage: { tank: 1, healer: 0, dps: 1 },
        },
      ],
    };
    expect(LfgGroupListResponseSchema.parse(body)).toEqual(body);
  });
  it('rejects an unknown kind and a negative roster count', () => {
    const g = { ...summary, groupKey: 'raid:1', kind: 'arena' };
    expect(LfgGroupListResponseSchema.safeParse({ gameId: 1, groups: [g] }).success).toBe(false);
    const neg = { ...summary, groupKey: 'raid:1', rosterShape: { tank: -1, healer: 1, dps: 1 } };
    expect(LfgGroupListResponseSchema.safeParse({ gameId: 1, groups: [neg] }).success).toBe(false);
  });
});

/**
 * ROK-1953 §4.4 — member status derivation (D6) and the `members[]` order
 * (I9 at unit level: unlockedCount desc, nulls last, then display name).
 */
import {
  memberStatus,
  sortMembers,
  toMemberStats,
  type MemberInput,
} from './steam-stats-read.helpers';
import { enabledAppId } from './steam-stats-read.service';

const at = new Date('2026-10-20T04:30:00.000Z');
const base: MemberInput = {
  userId: 1,
  displayName: 'Astarion',
  avatarUrl: null,
  steamId: '76561190000000001',
  stats: { status: 'ok', unlockedCount: 4, fetchedAt: at },
  playtimeMinutes: 600,
};

describe('memberStatus (D6)', () => {
  it('unlinked when steam_id is NULL, even with a kept ok row', () => {
    expect(memberStatus(null, base.stats)).toBe('unlinked');
  });
  it('pending when linked with no stats row', () => {
    expect(memberStatus('765', undefined)).toBe('pending');
  });
  it('the stored status otherwise', () => {
    expect(
      memberStatus('765', {
        status: 'private',
        unlockedCount: null,
        fetchedAt: at,
      }),
    ).toBe('private');
  });
});

describe('toMemberStats', () => {
  it('ok → counts, playtime and ISO fetchedAt', () => {
    expect(toMemberStats(base)).toEqual({
      userId: 1,
      displayName: 'Astarion',
      avatarUrl: null,
      status: 'ok',
      unlockedCount: 4,
      playtimeMinutes: 600,
      fetchedAt: '2026-10-20T04:30:00.000Z',
    });
  });
  it('private → unlockedCount null even if a stale count is stored', () => {
    const s = toMemberStats({
      ...base,
      stats: { status: 'private', unlockedCount: 9, fetchedAt: at },
    });
    expect([s.status, s.unlockedCount]).toEqual(['private', null]);
  });
  it('unlinked → no count, no playtime, no fetchedAt', () => {
    const s = toMemberStats({ ...base, steamId: null });
    expect([s.status, s.unlockedCount, s.playtimeMinutes, s.fetchedAt]).toEqual(
      ['unlinked', null, null, null],
    );
  });
});

describe('sortMembers (I9)', () => {
  it('unlockedCount desc, nulls last, ties by display name', () => {
    const mk = (userId: number, displayName: string, n: number | null) => ({
      ...toMemberStats({ ...base, userId, displayName }),
      unlockedCount: n,
    });
    const out = sortMembers([
      mk(1, 'Zed', null),
      mk(2, 'Bea', 3),
      mk(3, 'Ann', 3),
      mk(4, 'Cal', 7),
      mk(5, 'Abe', null),
    ]);
    expect(out.map((m) => m.displayName)).toEqual([
      'Cal',
      'Ann',
      'Bea',
      'Abe',
      'Zed',
    ]);
  });
});

describe('enabledAppId (D1/D9 — I7 at unit level)', () => {
  const t = { kind: 'game_community' as const, gameId: 7, appId: 1086940 };
  it('an enabled game kind + listed app id → the app id', () => {
    expect(enabledAppId(t)).toBe(1086940);
    expect(enabledAppId({ ...t, kind: 'game_server' })).toBe(1086940);
  });
  it('a WoW hub, a missing hub, no game, no app id or an unlisted id → null', () => {
    expect([
      enabledAppId({ ...t, kind: 'wow_guild' }),
      enabledAppId(undefined),
      enabledAppId({ ...t, gameId: null }),
      enabledAppId({ ...t, appId: null }),
      enabledAppId({ ...t, appId: 892970 }),
    ]).toEqual([null, null, null, null, null]);
  });
});

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
    expect(memberStatus('765', { status: 'private', unlockedCount: null, fetchedAt: at }))
      .toBe('private');
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
    expect([s.status, s.unlockedCount, s.playtimeMinutes, s.fetchedAt])
      .toEqual(['unlinked', null, null, null]);
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
      'Cal', 'Ann', 'Bea', 'Abe', 'Zed',
    ]);
  });
});

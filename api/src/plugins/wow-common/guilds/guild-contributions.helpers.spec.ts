/**
 * ROK-2148 D.3 — pure read helpers for the Guild contributions card:
 * T7 (30-day window edge), T8 (ordering, zeros, leavers, top-10 cap),
 * T9 (masters), T10 (users), plus the round-2 per-player roll-up and the
 * viewer's own rank outside the top 10.
 */
import { GuildContributionsGiversSchema } from '@raid-ledger/contract';
import {
  computeGivers,
  last30Items,
  type StoredGiver,
} from './guild-contributions.givers';
import {
  buildRoster,
  computeMasters,
  computeTemplate,
  computeUsers,
  dayIndex,
  USERS_MAX,
  type RosterRow,
  type StoredTemplate,
} from './guild-contributions.helpers';

const NOW_MS = Date.UTC(2026, 10, 8, 12);
const TODAY = dayIndex(NOW_MS);
const DAY_MS = 86_400_000;
const CHAR_A = '11111111-1111-4111-8111-111111111111';
const CHAR_B = '22222222-2222-4222-8222-222222222222';
const VIEWER = 7;

const member = (name: string, over: Partial<RosterRow> = {}): RosterRow => ({
  name,
  characterId: null,
  userId: null,
  ...over,
});

const giver = (name: string, over: Partial<StoredGiver> = {}): StoredGiver => ({
  nameKey: name.toLowerCase(),
  characterName: name,
  itemsAllTime: 0,
  countingSince: new Date(NOW_MS - 40 * DAY_MS),
  days: [],
  asOf: new Date(NOW_MS - DAY_MS),
  ...over,
});

const names = (rows: { characterName: string }[]) =>
  rows.map((r) => r.characterName);

describe('last30Items (T7)', () => {
  it('counts today−29 but not today−30', () => {
    const days = [
      { day: TODAY - 30, items: 100 },
      { day: TODAY - 29, items: 5 },
      { day: TODAY, items: 2 },
    ];
    expect(last30Items(days, TODAY)).toBe(7);
  });

  it('never counts a day after today (skewed clock / relayed data)', () => {
    const days = [
      { day: TODAY, items: 2 },
      { day: TODAY + 1, items: 50 },
      { day: TODAY + 10_000, items: 900 },
    ];
    expect(last30Items(days, TODAY)).toBe(2);
  });

  it('treats malformed stored days as none', () => {
    expect(last30Items([{ day: 'x', items: 3 }], TODAY)).toBe(0);
  });
});

describe('computeGivers (T8 + round 2)', () => {
  it('drops zeros and off-roster givers, ties sort by name', () => {
    const roster = buildRoster([member('Bree'), member('Abe'), member('Cal')]);
    const rows = [
      giver('Bree', { itemsAllTime: 5 }),
      giver('Abe', { itemsAllTime: 5 }),
      giver('Cal', { itemsAllTime: 0 }),
      giver('Gone', { itemsAllTime: 99 }),
    ];
    const out = computeGivers(rows, roster, TODAY, VIEWER);
    expect(names(out.allTime)).toEqual(['Abe', 'Bree']);
    expect(out.allTime.map((g) => g.rank)).toEqual([1, 2]);
    expect(out.allTimeTotal).toBe(10);
  });

  it('caps each board at 10 rows and still totals every on-roster row', () => {
    const list = Array.from(
      { length: 12 },
      (_, i) => `P${String(i).padStart(2, '0')}`,
    );
    const roster = buildRoster(list.map((n) => member(n)));
    const rows = list.map((n, i) => giver(n, { itemsAllTime: 100 - i }));
    const out = computeGivers(rows, roster, TODAY, VIEWER);
    expect(out.allTime).toHaveLength(10);
    expect(out.allTime[9]?.characterName).toBe('P09');
    expect(out.allTimeTotal).toBe(rows.reduce((s, r) => s + r.itemsAllTime, 0));
  });

  it("rolls a linked player's alts into one row named after the top alt", () => {
    const roster = buildRoster([
      member('Main', { characterId: CHAR_A, userId: 3 }),
      member('Alt', { characterId: CHAR_B, userId: 3 }),
      member('Solo'),
    ]);
    const rows = [
      giver('Main', { itemsAllTime: 4 }),
      giver('Alt', { itemsAllTime: 9 }),
      giver('Solo', { itemsAllTime: 10 }),
    ];
    const out = computeGivers(rows, roster, TODAY, VIEWER);
    expect(out.allTime).toEqual([
      {
        rank: 1,
        userId: 3,
        characterName: 'Alt',
        characterId: CHAR_B,
        characterCount: 2,
        items: 13,
        isYou: false,
      },
      {
        rank: 2,
        userId: null,
        characterName: 'Solo',
        characterId: null,
        characterCount: 1,
        items: 10,
        isYou: false,
      },
    ]);
  });

  it("returns the viewer's own row only when ranked outside the top 10", () => {
    const list = Array.from(
      { length: 11 },
      (_, i) => `P${String(i).padStart(2, '0')}`,
    );
    const roster = buildRoster([
      ...list.map((n) => member(n)),
      member('Me', { characterId: CHAR_A, userId: VIEWER }),
    ]);
    const rows = [
      ...list.map((n) => giver(n, { itemsAllTime: 50 })),
      giver('Me', { itemsAllTime: 1, days: [{ day: TODAY, items: 60 }] }),
    ];
    const out = computeGivers(rows, roster, TODAY, VIEWER);
    expect(out.youAllTime).toMatchObject({ rank: 12, isYou: true, items: 1 });
    expect(out.allTime.some((g) => g.isYou)).toBe(false);
    expect(out.last30Days[0]).toMatchObject({
      characterName: 'Me',
      isYou: true,
    });
    expect(out.youLast30Days).toBeNull();
  });

  it('countingSince = min, asOf = max over on-roster rows; parses the contract', () => {
    const roster = buildRoster([member('Abe'), member('Bree')]);
    const early = new Date(NOW_MS - 90 * DAY_MS);
    const late = new Date(NOW_MS - 1000);
    const rows = [
      giver('Abe', { itemsAllTime: 1, countingSince: early }),
      giver('Bree', { itemsAllTime: 1, asOf: late }),
      giver('Gone', { countingSince: new Date(0), asOf: new Date(NOW_MS) }),
    ];
    const out = computeGivers(rows, roster, TODAY, VIEWER);
    expect(out.countingSince).toBe(early.toISOString());
    expect(out.asOf).toBe(late.toISOString());
    expect(GuildContributionsGiversSchema.parse(out)).toEqual(out);
  });

  it('empty input → empty boards, zero totals, null dates', () => {
    const out = computeGivers([], buildRoster([]), TODAY, VIEWER);
    expect(out).toEqual({
      last30Days: [],
      allTime: [],
      youLast30Days: null,
      youAllTime: null,
      last30DaysTotal: 0,
      allTimeTotal: 0,
      countingSince: null,
      asOf: null,
    });
  });
});

describe('computeMasters / computeTemplate (T9)', () => {
  const template: StoredTemplate = {
    rev: 1_762_560_000,
    authorName: 'Officer',
    rules: [
      { professionSkillLineId: 333, recipientName: 'Linked' },
      { professionSkillLineId: 197, recipientName: 'Unlinked' },
      { professionSkillLineId: 171, recipientName: 'Departed' },
      { professionSkillLineId: 9999, recipientName: 'Linked' },
    ],
  };
  const roster = buildRoster([
    member('Linked', { characterId: CHAR_A, userId: 3 }),
    member('Unlinked'),
    member('Officer', { characterId: CHAR_B, userId: 4 }),
  ]);

  it('resolves each recipient against the roster, sorted by profession', () => {
    const out = computeMasters(template, roster);
    expect(out.map((m) => [m.profession, m.characterId, m.onRoster])).toEqual([
      ['Alchemy', null, false],
      ['Enchanting', CHAR_A, true],
      ['Profession 9999', CHAR_A, true],
      ['Tailoring', null, true],
    ]);
    expect(out[1]?.title).toBe('Guild Enchanter');
  });

  it('no template or malformed rules → no masters', () => {
    expect(computeMasters(null, roster)).toEqual([]);
    expect(computeMasters({ ...template, rules: [{ x: 1 }] }, roster)).toEqual(
      [],
    );
  });

  it('template header carries rev as ISO and the author character', () => {
    expect(computeTemplate(template, roster)).toEqual({
      rev: new Date(template.rev * 1000).toISOString(),
      authorName: 'Officer',
      authorCharacterId: CHAR_B,
    });
    expect(computeTemplate(null, roster)).toBeNull();
  });
});

describe('computeUsers (T10)', () => {
  it('keeps on-roster peers seen within 60 days, sorted by name', () => {
    const roster = buildRoster([
      member('Zed', { characterId: CHAR_A, userId: 3 }),
      member('Amy'),
      member('Old'),
    ]);
    const peers = [
      { name: 'Zed', lastSeenAt: new Date(NOW_MS - 60 * DAY_MS) },
      { name: 'Amy', lastSeenAt: new Date(NOW_MS - DAY_MS) },
      { name: 'Old', lastSeenAt: new Date(NOW_MS - 61 * DAY_MS) },
      { name: 'Stranger', lastSeenAt: new Date(NOW_MS) },
    ];
    const out = computeUsers(peers, roster, NOW_MS);
    expect(out.map((u) => [u.characterName, u.characterId])).toEqual([
      ['Amy', null],
      ['Zed', CHAR_A],
    ]);
  });

  it('never returns more users than the DTO accepts', () => {
    const many = Array.from({ length: USERS_MAX + 5 }, (_, n) => `P${n}`);
    const roster = buildRoster(many.map((n) => member(n)));
    const peers = many.map((name) => ({ name, lastSeenAt: new Date(NOW_MS) }));
    expect(computeUsers(peers, roster, NOW_MS)).toHaveLength(USERS_MAX);
  });
});

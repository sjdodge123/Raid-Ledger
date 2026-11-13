/**
 * ROK-1789 Part B — the Progression tab contract: per-instance boss progress
 * (B1–B3, Q-B11/Q-B12), the 30-day activity feed (B5–B8) with grouped
 * milestone rows (Q-B13) and collapsed roster imports (Q-B14), and the
 * blizzard manifest tab that is no longer `planned`.
 */
import { describe, expect, it } from 'vitest';
import {
  GUILD_ACTIVITY_KINDS,
  GUILD_ACTIVITY_MAX,
  GUILD_ACTIVITY_NAMES_MAX,
  GUILD_ACTIVITY_PAGE,
  GUILD_ACTIVITY_WINDOW_DAYS,
  GUILD_MILESTONE_GROUP_MIN,
  GUILD_ROSTER_IMPORT_MIN,
  HUB_PLUGIN_MANIFESTS,
  WOW_PROGRESSION_INSTANCES_MAX,
  WowGuildActivityEntrySchema,
  WowGuildActivitySchema,
  WowGuildProgressionPageSchema,
  WowGuildProgressionSchema,
  WowProgressionBossSchema,
  WowProgressionInstanceSchema,
} from '../index.js';

const AT = '2026-11-10T20:00:00.000Z';

const boss = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  encounterId: 663,
  difficultyId: 9,
  difficultyLabel: '40',
  name: 'Lucifron',
  firstKillAt: AT,
  kills: 2,
  wipes: 1,
  lastPullAt: AT,
  order: 1,
  ...over,
});

const instance = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  key: 'j:741',
  name: 'Molten Core',
  bossesDown: 1,
  bossTotal: 10,
  showDifficulty: false,
  latestKill: { name: 'Lucifron', at: AT },
  bosses: [boss()],
  ...over,
});

const progression = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  instances: [instance()],
  pullCount: 3,
  lastPullAt: AT,
  ...over,
});

const ENTRIES: Record<string, Record<string, unknown>> = {
  first_kill: { kind: 'first_kill', id: 'kill:663:9', at: AT, bossName: 'Lucifron', difficultyLabel: '40', instanceName: 'Molten Core' },
  new_member: { kind: 'new_member', id: 'join:m1', at: AT, characterName: 'Thalia', characterId: null, className: 'Priest' },
  roster_import: { kind: 'roster_import', id: `import:${AT}`, at: AT, count: 12, names: ['Thalia', 'Bram'] },
  event: { kind: 'event', id: 'event:7', at: AT, eventId: 7, title: 'Molten Core run' },
  ding: { kind: 'ding', id: 'ding:9', at: AT, characterName: 'Bram', characterId: '9d3c6a1e-0b5e-4c1a-9a51-1f0f8b7f2a10', toLevel: 60 },
  milestone: { kind: 'milestone', id: 'ms:m1:1', at: AT, characterName: 'Thalia', characterId: null, months: 1, count: 1, names: ['Thalia'] },
};

const entry = (kind: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...ENTRIES[kind],
  ...over,
});

describe('WowGuildProgressionSchema', () => {
  it('accepts a grouped instance with a boss order and a known total', () => {
    expect(WowGuildProgressionSchema.safeParse(progression()).success).toBe(true);
  });

  it('accepts the "N/?" case (null total), the other bucket and an unmatched boss order', () => {
    const other = instance({ key: 'other', name: 'Other bosses', bossTotal: null, latestKill: null, bosses: [boss({ order: null, firstKillAt: null, kills: 0 })] });
    expect(WowGuildProgressionSchema.safeParse(progression({ instances: [instance({ key: 'm:2717' }), other] })).success).toBe(true);
  });

  it('accepts an empty progression', () => {
    expect(WowGuildProgressionSchema.safeParse({ instances: [], pullCount: 0, lastPullAt: null }).success).toBe(true);
  });

  it.each(['journal:741', 'j:', 'm:abc', 'Other', ''])('rejects the instance key %j', (key) => {
    expect(WowProgressionInstanceSchema.safeParse(instance({ key })).success).toBe(false);
  });

  it('rejects a negative bossesDown, a missing showDifficulty and an extra key', () => {
    expect(WowProgressionInstanceSchema.safeParse(instance({ bossesDown: -1 })).success).toBe(false);
    expect(WowProgressionInstanceSchema.safeParse(instance({ showDifficulty: undefined })).success).toBe(false);
    expect(WowProgressionInstanceSchema.safeParse(instance({ extra: 1 })).success).toBe(false);
  });

  it('requires a boss order (nullable, not optional)', () => {
    expect(WowProgressionBossSchema.safeParse(boss({ order: undefined })).success).toBe(false);
    expect(WowProgressionBossSchema.safeParse(boss({ order: 1.5 })).success).toBe(false);
  });

  it(`caps instances at ${WOW_PROGRESSION_INSTANCES_MAX} but not bosses at the widget's 60`, () => {
    const many = Array.from({ length: WOW_PROGRESSION_INSTANCES_MAX + 1 }, (_, i) => instance({ key: `m:${i}` }));
    expect(WowGuildProgressionSchema.safeParse(progression({ instances: many })).success).toBe(false);
    const bosses = Array.from({ length: 61 }, (_, i) => boss({ encounterId: i }));
    expect(WowProgressionInstanceSchema.safeParse(instance({ bosses })).success).toBe(true);
  });
});

describe('WowGuildActivityEntrySchema', () => {
  it('lists the six kinds, roster_import included (Q-B14)', () => {
    expect([...GUILD_ACTIVITY_KINDS]).toEqual(['first_kill', 'new_member', 'roster_import', 'event', 'ding', 'milestone']);
  });

  it.each(Object.keys(ENTRIES))('accepts a %s entry', (kind) => {
    expect(WowGuildActivityEntrySchema.safeParse(entry(kind)).success).toBe(true);
  });

  it.each(Object.keys(ENTRIES))('rejects an extra key on a %s entry', (kind) => {
    expect(WowGuildActivityEntrySchema.safeParse(entry(kind, { extra: true })).success).toBe(false);
  });

  it('rejects an unknown kind and a non-uuid characterId', () => {
    expect(WowGuildActivityEntrySchema.safeParse(entry('ding', { kind: 'achievement' })).success).toBe(false);
    expect(WowGuildActivityEntrySchema.safeParse(entry('ding', { characterId: 'abc' })).success).toBe(false);
  });

  it.each([1, 6, 12])('accepts a %i-month milestone', (months) => {
    expect(WowGuildActivityEntrySchema.safeParse(entry('milestone', { months })).success).toBe(true);
  });

  it.each([0, 2, 3, 24])('rejects a %i-month milestone', (months) => {
    expect(WowGuildActivityEntrySchema.safeParse(entry('milestone', { months })).success).toBe(false);
  });

  it('accepts a grouped milestone row: count > names, names capped (Q-B13)', () => {
    const names = Array.from({ length: GUILD_ACTIVITY_NAMES_MAX }, (_, i) => `M${i}`);
    const grouped = entry('milestone', { id: 'ms:2026-11-10:1', count: 49, names });
    expect(WowGuildActivityEntrySchema.safeParse(grouped).success).toBe(true);
    expect(WowGuildActivityEntrySchema.safeParse({ ...grouped, names: [...names, 'one more'] }).success).toBe(false);
  });

  it('rejects names longer than count, an empty names list and a zero count', () => {
    const bad = [{ count: 1, names: ['A', 'B'] }, { count: 1, names: [] }, { count: 0, names: [] }];
    for (const over of bad) {
      expect(WowGuildActivityEntrySchema.safeParse(entry('milestone', over)).success).toBe(false);
    }
  });

  it(`rejects a roster import below ${GUILD_ROSTER_IMPORT_MIN} members`, () => {
    expect(WowGuildActivityEntrySchema.safeParse(entry('roster_import', { count: GUILD_ROSTER_IMPORT_MIN - 1 })).success).toBe(false);
    expect(WowGuildActivityEntrySchema.safeParse(entry('roster_import', { count: GUILD_ROSTER_IMPORT_MIN })).success).toBe(true);
  });

  it('rejects an event title over 200 characters and a non-integer level', () => {
    expect(WowGuildActivityEntrySchema.safeParse(entry('event', { title: 'x'.repeat(201) })).success).toBe(false);
    expect(WowGuildActivityEntrySchema.safeParse(entry('ding', { toLevel: 59.5 })).success).toBe(false);
  });
});

describe('WowGuildActivitySchema + page', () => {
  it('pins the window, page size, server cap and group thresholds', () => {
    expect([GUILD_ACTIVITY_WINDOW_DAYS, GUILD_ACTIVITY_PAGE, GUILD_ACTIVITY_MAX]).toEqual([30, 25, 200]);
    expect([GUILD_MILESTONE_GROUP_MIN, GUILD_ROSTER_IMPORT_MIN]).toEqual([4, 10]);
  });

  it(`accepts ${GUILD_ACTIVITY_MAX} entries and rejects one more`, () => {
    const entries = Array.from({ length: GUILD_ACTIVITY_MAX }, (_, i) => entry('event', { id: `event:${i}`, eventId: i + 1 }));
    expect(WowGuildActivitySchema.safeParse({ entries, windowDays: 30 }).success).toBe(true);
    expect(WowGuildActivitySchema.safeParse({ entries: [...entries, entry('ding')], windowDays: 30 }).success).toBe(false);
  });

  it('rejects any windowDays other than 30', () => {
    expect(WowGuildActivitySchema.safeParse({ entries: [], windowDays: 7 }).success).toBe(false);
  });

  it('parses the route response and narrows entries by kind', () => {
    const page = WowGuildProgressionPageSchema.parse({
      progression: progression(),
      activity: { entries: [entry('milestone'), entry('first_kill')], windowDays: 30 },
    });
    const first = page.activity.entries[0];
    expect(first?.kind === 'milestone' ? first.months : null).toBe(1);
  });

  it('rejects an extra top-level key', () => {
    const activity = { entries: [], windowDays: 30 };
    expect(WowGuildProgressionPageSchema.safeParse({ progression: progression(), activity, x: 1 }).success).toBe(false);
  });
});

describe('blizzard manifest', () => {
  it('ships the Progression tab (no longer planned) and keeps Loot planned', () => {
    const tabs = HUB_PLUGIN_MANIFESTS.blizzard.tabs;
    expect(tabs.find((t) => t.id === 'progression')).toEqual({ id: 'progression', label: 'Progression' });
    expect(tabs.find((t) => t.id === 'loot')).toEqual({ id: 'loot', label: 'Loot', planned: true });
  });
});

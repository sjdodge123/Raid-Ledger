/**
 * ROK-1789 B9 — the pure halves of the seed-guild `withActivity` showcase:
 * backdated join stamps, guild events and the extra boss pulls.
 */
import {
  ACTIVITY_WINDOW_MS,
  activityEventSpecs,
  activityPullRows,
  activityTimeline,
  fillerJoinStamps,
  monthsBeforeUtc,
  SHOWCASE_MC_INSTANCE_ID,
} from './demo-test-guild-activity.helpers';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;
const inWindow = (at: Date): boolean =>
  at.getTime() <= NOW.getTime() &&
  at.getTime() > NOW.getTime() - ACTIVITY_WINDOW_MS;

describe('monthsBeforeUtc', () => {
  it('steps back whole UTC calendar months and clamps the day', () => {
    expect(monthsBeforeUtc(NOW, 1).toISOString()).toBe(
      '2026-10-13T12:00:00.000Z',
    );
    expect(monthsBeforeUtc(NOW, 12).toISOString()).toBe(
      '2025-11-13T12:00:00.000Z',
    );
    const endOfMarch = new Date('2026-03-31T00:00:00.000Z');
    expect(monthsBeforeUtc(endOfMarch, 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });
});

describe('activityTimeline', () => {
  const t = activityTimeline(NOW);

  it('founds the guild 400 days ago and keeps the joins inside the window', () => {
    expect(t.guildCreatedAt.toISOString()).toBe(
      new Date(NOW.getTime() - 400 * DAY).toISOString(),
    );
    expect(t.newMemberAts).toHaveLength(4);
    expect(new Set(t.newMemberAts.map((d) => d.getTime())).size).toBe(4);
    expect(t.newMemberAts.every(inWindow)).toBe(true);
    expect(inWindow(t.rosterImportAt)).toBe(true);
  });

  it('puts each milestone (1/6/12 months) three days inside the window', () => {
    expect(t.milestones.map((m) => m.months)).toEqual([1, 6, 12]);
    for (const m of t.milestones) {
      const due = monthsBeforeUtc(NOW, m.months).getTime() - 3 * DAY;
      expect(m.at.getTime()).toBe(due);
    }
    const grouped = monthsBeforeUtc(NOW, 1).getTime() - 10 * DAY;
    expect(t.groupedMilestoneAt.getTime()).toBe(grouped);
  });
});

describe('fillerJoinStamps', () => {
  const t = activityTimeline(NOW);
  const ids = Array.from({ length: 45 }, (_, i) => 1000 + i);

  it('stamps 4 new members, a 12-row import, 3 milestones and a group of 4', () => {
    const plan = fillerJoinStamps(ids, t);
    const at = (kind: string): number[] =>
      plan.filter((p) => p.kind === kind).map((p) => p.createdAt.getTime());
    expect(at('new_member')).toHaveLength(4);
    expect(at('roster_import')).toHaveLength(12);
    expect(new Set(at('roster_import'))).toEqual(
      new Set([t.rosterImportAt.getTime()]),
    );
    expect(at('milestone')).toHaveLength(3);
    expect(new Set(at('grouped_milestone'))).toEqual(
      new Set([t.groupedMilestoneAt.getTime()]),
    );
    expect(at('grouped_milestone')).toHaveLength(4);
    expect(new Set(plan.map((p) => p.memberId)).size).toBe(plan.length);
  });

  it('skips the import (never below 10 rows) when too few fillers remain', () => {
    const plan = fillerJoinStamps(ids.slice(0, 12), t);
    expect(plan.map((p) => p.kind)).toEqual([
      ...Array<string>(4).fill('new_member'),
      ...Array<string>(3).fill('milestone'),
      ...Array<string>(4).fill('grouped_milestone'),
    ]);
  });
});

describe('activityEventSpecs', () => {
  it('two ended events in the window and one cancelled one', () => {
    const specs = activityEventSpecs(NOW);
    const ended = specs.filter((s) => !s.cancelled);
    expect(ended).toHaveLength(2);
    expect(ended.every((s) => inWindow(s.end) && s.end > s.start)).toBe(true);
    expect(specs.filter((s) => s.cancelled)).toHaveLength(1);
    expect(new Set(specs.map((s) => s.title)).size).toBe(3);
  });
});

describe('activityPullRows', () => {
  const rows = activityPullRows({
    gameId: 7,
    guildKey: 'showcase',
    reporters: { gm: 1, officer: 2, outsider: 3 },
    now: NOW,
  });

  it('adds Molten Core first kills on map 409, inside the window', () => {
    const mc = rows.filter((r) => r.instanceId === SHOWCASE_MC_INSTANCE_ID);
    expect(mc.length).toBeGreaterThanOrEqual(2);
    expect(mc.every((r) => r.success && inWindow(r.startAt))).toBe(true);
    expect(mc.every((r) => r.reportedByUserId !== 3)).toBe(true);
  });

  it('adds one Lucifron kill with no instance on a second difficulty', () => {
    const other = rows.filter((r) => r.instanceId === null);
    expect(other.map((r) => [r.encounterName, r.success])).toEqual([
      ['Lucifron', true],
    ]);
    const diffs = new Set(rows.map((r) => r.difficultyId));
    expect(diffs.size).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.payloadSha256)).size).toBe(rows.length);
  });
});

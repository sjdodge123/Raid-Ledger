/**
 * ROK-1917 — the seed-guild `withPulls` fixture: the flag parses, and the
 * seeded pulls produce exactly what the response promises the widget shows
 * once the trust filter (Q1) and the near-dup collapse (D4) have run.
 */
import { BadRequestException } from '@nestjs/common';
import {
  computeRaidProgress,
  type RaidPull,
} from '../plugins/wow-common/guilds/roster-insights/roster-insights.raid-progress';
import {
  SEEDED_GUILD_PULLS,
  seedPullRows,
} from './demo-test-guild-pulls.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';

const REPORTERS = { gm: 11, officer: 12, outsider: 13 };
const NOW = new Date('2026-10-30T12:00:00Z');
const ROWS = seedPullRows({
  gameId: 7,
  guildKey: 'pull guild',
  reporters: REPORTERS,
  now: NOW,
});

/** The rows a hub whose linked roster is `trusted` would read. */
function pullsReportedBy(trusted: readonly number[]): RaidPull[] {
  return ROWS.filter((r) => trusted.includes(r.reportedByUserId ?? -1)).map(
    (r) => ({
      encounterId: r.encounterId,
      encounterName: r.encounterName,
      difficultyId: r.difficultyId,
      startAt: r.startAt,
      endAt: r.endAt,
      success: r.success,
    }),
  );
}

describe('parseSeedGuildBody withPulls', () => {
  it('defaults to false, accepts true, rejects a non-boolean', () => {
    expect(parseSeedGuildBody({ name: 'Pull Guild' }).withPulls).toBe(false);
    expect(
      parseSeedGuildBody({ name: 'Pull Guild', withPulls: true }).withPulls,
    ).toBe(true);
    expect(() =>
      parseSeedGuildBody({ name: 'Pull Guild', withPulls: 1 }),
    ).toThrow(new BadRequestException('withPulls must be a boolean'));
  });
});

describe('seedPullRows', () => {
  it('matches the seeded summary after the trust filter and near-dup collapse', () => {
    const progress = computeRaidProgress(
      pullsReportedBy([REPORTERS.gm, REPORTERS.officer]),
    );
    const summary = SEEDED_GUILD_PULLS;
    expect(progress.killedCount).toBe(summary.killedCount);
    expect(progress.pullCount).toBe(summary.pullCount);
    expect(
      progress.bosses.map((b) => [b.name, b.kills, b.wipes, !!b.firstKillAt]),
    ).toEqual([
      [summary.killed.name, summary.killed.kills, summary.killed.wipes, true],
      [summary.unkilled.name, 0, summary.unkilled.wipes, false],
    ]);
  });

  it('carries a second-exporter near-duplicate and an untrusted kill', () => {
    const reporters = new Set(ROWS.map((r) => r.reportedByUserId));
    expect(reporters).toEqual(new Set(Object.values(REPORTERS)));
    const everyone = computeRaidProgress(
      pullsReportedBy(Object.values(REPORTERS)),
    );
    expect(everyone.bosses.map((b) => b.name)).toContain(
      SEEDED_GUILD_PULLS.untrusted,
    );
  });

  it('keeps every row distinct on the DB dedupe key, all in the past and scoped', () => {
    const keys = ROWS.map((r) => `${r.encounterId}:${r.startAt.getTime()}`);
    expect(new Set(keys).size).toBe(ROWS.length);
    expect(
      ROWS.every((r) => r.endAt < NOW && r.guildKey === 'pull guild'),
    ).toBe(true);
    expect(new Set(ROWS.map((r) => r.payloadSha256)).size).toBe(ROWS.length);
  });
});

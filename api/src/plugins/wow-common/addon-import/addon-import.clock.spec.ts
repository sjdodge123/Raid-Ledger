/**
 * ROK-1756 — export timestamps are bounded by the server clock: nothing over
 * a day ahead, the export / guild snapshot no older than a year, raid pulls
 * only bounded on the future side.
 */
import {
  assertPlausibleExportTimes,
  EXPORT_MAX_AGE_S,
  EXPORT_MAX_FUTURE_S,
  EXPORT_TIME_MESSAGE,
} from './addon-import.clock';
import {
  buildGuildPayload,
  buildRaidPayload,
} from './testing/addon-fixture.builder';

const NOW_S = 1_790_000_000;
const NOW_MS = NOW_S * 1000;
const HOUR_S = 3600;

const guildAt = (snapshotAt: number, exportedAt = NOW_S) => {
  const g = buildGuildPayload();
  return { ...g, exportedAt, data: { ...g.data, snapshotAt } };
};

const raidWithPull = (startAt: number) => {
  const r = buildRaidPayload();
  const pulls = r.data.pulls.map((p) => ({ ...p, startAt, endAt: startAt }));
  return { ...r, exportedAt: NOW_S, data: { ...r.data, pulls } };
};

const check = (p: Parameters<typeof assertPlausibleExportTimes>[0]) => () =>
  assertPlausibleExportTimes(p, NOW_MS);

describe('assertPlausibleExportTimes (ROK-1756)', () => {
  it('accepts a guild snapshot up to the 24 h skew allowance', () => {
    expect(EXPORT_MAX_FUTURE_S).toBe(24 * HOUR_S);
    expect(check(guildAt(NOW_S + EXPORT_MAX_FUTURE_S))).not.toThrow();
  });

  it('rejects a guild snapshot more than a day ahead with 422 INVALID_PAYLOAD', () => {
    expect(check(guildAt(NOW_S + 25 * HOUR_S))).toThrow(EXPORT_TIME_MESSAGE);
    try {
      check(guildAt(4_102_444_799))();
    } catch (err) {
      expect((err as { getStatus(): number }).getStatus()).toBe(422);
    }
    expect.assertions(2);
  });

  it('rejects a future exportedAt even when the snapshot is honest', () => {
    expect(check(guildAt(NOW_S, NOW_S + 2 * 24 * HOUR_S))).toThrow(
      EXPORT_TIME_MESSAGE,
    );
  });

  it('rejects an export or snapshot older than a year', () => {
    const old = NOW_S - EXPORT_MAX_AGE_S - HOUR_S;
    expect(check(guildAt(old))).toThrow(EXPORT_TIME_MESSAGE);
    expect(check(guildAt(NOW_S, old))).toThrow(EXPORT_TIME_MESSAGE);
  });

  it('bounds raid pulls on the future side only', () => {
    expect(check(raidWithPull(NOW_S + 25 * HOUR_S))).toThrow(
      EXPORT_TIME_MESSAGE,
    );
    expect(check(raidWithPull(NOW_S - 3 * EXPORT_MAX_AGE_S))).not.toThrow();
  });
});

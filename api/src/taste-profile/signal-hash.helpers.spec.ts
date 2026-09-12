/**
 * Signal hash unit tests (ROK-948 AC 8).
 *
 * Contract (from enriched spec):
 *   SHA256 of a string of the form
 *     "game_interests:{count}:{max_updated_at}|
 *      game_activity_rollups:{count}:{max_period_start}|
 *      event_signups:{count}:{max_updated_at}|
 *      event_voice_sessions:{count}:{max_last_leave_at}"
 *   per user. Stable across identical inputs, different when any input changes.
 */
import {
  SIGNAL_HASH_VERSION,
  computeSignalHash,
  type SignalSummary,
} from './signal-hash.helpers';

describe('signal hash (ROK-948 AC 8)', () => {
  const fixed = new Date('2026-04-01T00:00:00Z');

  const baseline: SignalSummary = {
    gameInterests: { count: 3, maxUpdatedAt: fixed },
    gameActivityRollups: { count: 5, maxPeriodStart: '2026-03-31' },
    eventSignups: { count: 2, maxUpdatedAt: fixed },
    eventVoiceSessions: { count: 1, maxLastLeaveAt: fixed },
  };

  it('produces the same hash for identical inputs', () => {
    expect(computeSignalHash(baseline)).toBe(computeSignalHash(baseline));
  });

  it('produces a hex SHA-256 string (64 chars)', () => {
    const h = computeSignalHash(baseline);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when a source count changes', () => {
    const bumped: SignalSummary = {
      ...baseline,
      gameInterests: { ...baseline.gameInterests, count: 4 },
    };
    expect(computeSignalHash(bumped)).not.toBe(computeSignalHash(baseline));
  });

  it('changes when a max timestamp advances', () => {
    const newer: SignalSummary = {
      ...baseline,
      eventVoiceSessions: {
        count: baseline.eventVoiceSessions.count,
        maxLastLeaveAt: new Date('2026-04-02T00:00:00Z'),
      },
    };
    expect(computeSignalHash(newer)).not.toBe(computeSignalHash(baseline));
  });

  it('treats null/undefined max values as distinct from an epoch timestamp', () => {
    const emptied: SignalSummary = {
      ...baseline,
      eventSignups: { count: 0, maxUpdatedAt: null },
    };
    expect(computeSignalHash(emptied)).not.toBe(computeSignalHash(baseline));
  });

  /**
   * ROK-1102 item 5 (§4.1 unit 8) — player-side twin of the game-side salt
   * assertion. The player pool is the same 25-axis pool, so player vectors
   * need the identical forcing or they keep their pre-`fps` dimensions.
   * Digests are captured (pre-salt / v:1), never recomputed.
   */
  const PRE_SALT_DIGEST =
    'c92a9c620574c1222310da97af4c95319508b27fec1dd69ae465f608395a01e7';
  const VERSION_1_DIGEST =
    'b53fffc6007011f840f8cc988fb72576ca9ac2751564911ecce030c6b1f9934e';

  it('salts the digest with SIGNAL_HASH_VERSION (salt is present)', () => {
    expect(computeSignalHash(baseline)).not.toBe(PRE_SALT_DIGEST);
  });

  it('changes when SIGNAL_HASH_VERSION is bumped past 1', () => {
    expect(SIGNAL_HASH_VERSION).toBeGreaterThan(1);
    expect(computeSignalHash(baseline)).not.toBe(VERSION_1_DIGEST);
  });
});

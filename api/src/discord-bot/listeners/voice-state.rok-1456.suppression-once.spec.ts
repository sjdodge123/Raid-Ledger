/**
 * ROK-1456 — the ROK-959 suppression guard runs EXACTLY once per spawn-path
 * join, and the listener hands its receipt to `handleVoiceJoin` so the service
 * does not run it a second time.
 *
 * Severity table this pins (per-path `ensureNotSuppressed` call counts):
 *   existing-event join  → 0 (reconciles via `trackAndJoinExisting`)
 *   below-threshold join → 1 (listener only; nothing to spawn)
 *   immediate spawn      → 1 (was 2 before ROK-1456)
 *   delayed spawn        → listener at join time + the service at FIRE time,
 *                          because the timer carries no receipt on purpose.
 */
import {
  CHANNEL_ID,
  FAKE_CLEARANCE,
  gameBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const BOUND_GAME = { gameId: 1, gameName: 'Rise of Kingdoms' };
const BINDING = 'bind-game';

describe('ROK-1456 — suppression guard runs once per spawn-path join', () => {
  let h: Rok1445Harness;

  beforeEach(async () => {
    jest.useFakeTimers();
    h = await setupRok1445Harness(gameBinding());
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  const guard = () => h.mocks.adHocEventService.ensureNotSuppressed;
  const join = () => h.mocks.adHocEventService.handleVoiceJoin;

  it('below-threshold join runs ensureNotSuppressed exactly once and never calls handleVoiceJoin', async () => {
    await h.joinMember({ id: 'u1', ...BOUND_GAME });

    expect(guard()).toHaveBeenCalledTimes(1);
    expect(guard()).toHaveBeenCalledWith(
      BINDING,
      BOUND_GAME.gameId,
      CHANNEL_ID,
    );
    expect(join()).not.toHaveBeenCalled();
  });

  it('immediate spawn runs ensureNotSuppressed exactly once and hands its clearance to handleVoiceJoin', async () => {
    await h.joinMember({ id: 'u1', ...BOUND_GAME });
    guard().mockClear();

    await h.joinMember({ id: 'u2', ...BOUND_GAME });

    expect(guard()).toHaveBeenCalledTimes(1);
    const calls = h.joinCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.clearance).toBe(FAKE_CLEARANCE);
  });

  it('existing-event join runs ensureNotSuppressed zero times', async () => {
    await h.joinMember({ id: 'u1', ...BOUND_GAME });
    await h.joinMember({ id: 'u2', ...BOUND_GAME });
    expect(h.eventKeys()).toEqual([`${BINDING}:1`]);
    guard().mockClear();
    join().mockClear();

    await h.joinMember({ id: 'u3', ...BOUND_GAME });

    expect(guard()).not.toHaveBeenCalled();
    expect(h.joinCalls().map((c) => c.memberId)).toEqual(['u3']);
  });

  it('suppressed join emits the suppressed-scheduled gate trace and arms no spawn', async () => {
    guard().mockResolvedValue(null);

    await h.joinMember({ id: 'u1', ...BOUND_GAME });
    await h.joinMember({ id: 'u2', ...BOUND_GAME });

    expect(h.gateLines().some((l) => l.includes('suppressed-scheduled'))).toBe(
      true,
    );
    expect(join()).not.toHaveBeenCalled();
    expect(h.spawnTimerKeys()).toEqual([]);
    await h.advanceSpawnDelay();
    expect(join()).not.toHaveBeenCalled();
  });

  it('delayed spawn re-checks at fire time (no clearance carried across the timer)', async () => {
    await h.joinMember({ id: 'u1', ...BOUND_GAME });
    await h.joinMember({ id: 'u2', gameId: null });
    expect(h.spawnTimerKeys()).toHaveLength(1);
    guard().mockClear();
    join().mockClear();

    await h.advanceSpawnDelay();

    const calls = h.joinCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.clearance).toBeUndefined();
  });
});

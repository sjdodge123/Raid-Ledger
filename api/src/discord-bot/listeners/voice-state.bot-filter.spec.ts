/**
 * ROK-1445 AC9 — the bot filter must be scoped to COUNTS and ROSTERS.
 *
 * The first cut of AC9 gated the whole join dispatch on `user.bot`, which
 * early-returned before `resolveAllBindings`. A bot's voice join therefore
 * never reached `handleGameBindingJoin` -> `suppressOrCheckThreshold` ->
 * `trySuppressForScheduled`, so ROK-959 sibling-binding suppression stopped
 * writing `extended_until`. The fleet smoke caught it (`extendedUntil not set
 * on event 83`), and the same over-reach would have made every bot-driven
 * Discord voice smoke test vacuous, because the companion bot is the only way
 * smoke can simulate a voice join.
 *
 * These are the deterministic guards for that boundary: a bot still drives
 * binding dispatch and suppression, but never lands in `channelMembers` and
 * never lands on a roster.
 */
import {
  BINDING_ID,
  CHANNEL_ID,
  gameBinding,
  lobbyBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };
const BOUND_GAME = { gameId: 1, gameName: 'Rise of Kingdoms' };

/** The listener's private channel-occupancy map. */
function occupancy(h: Rok1445Harness): string[] {
  const map = (
    h.listener as unknown as { channelMembers: Map<string, Set<string>> }
  ).channelMembers;
  return [...(map.get(CHANNEL_ID) ?? [])].sort();
}

describe('ROK-1445 AC9 — bot filter is scoped to counts and rosters', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  describe('game-voice-monitor binding', () => {
    it("still runs sibling-binding suppression for a bot's join (ROK-959)", async () => {
      h = await setupRok1445Harness(gameBinding());

      await h.joinMember({ id: 'bot9', ...BOUND_GAME, bot: true });

      // The regression: this was 0 calls when the filter short-circuited
      // dispatch, so `extended_until` was never written.
      expect(
        h.mocks.adHocEventService.trySuppressForScheduled,
      ).toHaveBeenCalledWith('bind-game', BOUND_GAME.gameId, CHANNEL_ID);
    });

    it('does not count a bot toward channel occupancy', async () => {
      h = await setupRok1445Harness(gameBinding());

      await h.joinMember({ id: 'u1', ...BOUND_GAME });
      await h.joinMember({ id: 'bot9', ...BOUND_GAME, bot: true });

      expect(occupancy(h)).toEqual(['u1']);
    });

    it('does not roster a bot into an event that already exists', async () => {
      h = await setupRok1445Harness(gameBinding());
      await h.joinMember({ id: 'u1', ...BOUND_GAME });
      await h.joinMember({ id: 'u2', ...BOUND_GAME });
      await h.advanceSpawnDelay();
      expect(h.eventKeys()).toEqual(['bind-game:1']);

      await h.joinMember({ id: 'bot9', ...BOUND_GAME, bot: true });

      expect(h.rosterOf('bind-game:1')).toEqual(['u1', 'u2']);
      expect(h.joinCalls().map((c) => c.memberId)).not.toContain('bot9');
    });
  });

  describe('general-lobby binding', () => {
    it('does not count a bot toward channel occupancy', async () => {
      h = await setupRok1445Harness(lobbyBinding());

      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'bot9', ...COD4, bot: true });

      expect(occupancy(h)).toEqual(['u1']);
    });

    it('does not roster a bot into a lobby event that already exists', async () => {
      h = await setupRok1445Harness(lobbyBinding());
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.advanceSpawnDelay();
      expect(h.eventKeys()).toEqual([`${BINDING_ID}:${COD4.gameId}`]);

      await h.joinMember({ id: 'bot9', ...COD4, bot: true });

      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1', 'u2']);
    });

    it('does not buffer game activity for a bot', async () => {
      h = await setupRok1445Harness(lobbyBinding());

      await h.joinMember({ id: 'bot9', ...COD4, bot: true });

      expect(h.mocks.gameActivityService.bufferStart).not.toHaveBeenCalled();
    });
  });
});

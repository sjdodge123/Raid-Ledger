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
import { Collection } from 'discord.js';
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
const DEEP_ROCK = { gameId: 9, gameName: 'Deep Rock Galactic' };

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

  // ─── Review MED-1: never mint a second event alongside an existing one ────

  describe('MED-1 — fixed-game bind that already holds a live event', () => {
    /**
     * Reach the `allConfirmed` immediate-spawn branch while a DEGRADED
     * `bind-game:null` event is already live. Humans join presence-null (so
     * ROK-1394 degrades the spawn), then their presence resolves to the bound
     * game. A later human join would reconcile into `bind-game:null` via
     * `trackAndJoinExisting`, but a bot skips that step by design — it must
     * still reach suppression — so only the bot path can reach the mint.
     */
    async function degradedEventThenAllConfirmed(): Promise<void> {
      h = await setupRok1445Harness(gameBinding({ config: { minPlayers: 2 } }));
      await h.joinMember({ id: 'u1', gameId: null });
      await h.joinMember({ id: 'u2', gameId: null });
      await h.advanceSpawnDelay();
      expect(h.eventKeys()).toEqual(['bind-game:null']);
      // The humans launch the bound game (no re-dispatch on a game binding).
      await h.changePresence('u1', BOUND_GAME);
      await h.changePresence('u2', BOUND_GAME);
    }

    it('does not mint a second event when a bot join reaches the spawn path', async () => {
      await degradedEventThenAllConfirmed();

      await h.joinMember({ id: 'bot9', ...BOUND_GAME, bot: true });

      // Without the ROK-1394 guard this keys a SECOND event `bind-game:1`,
      // leaving u1/u2 rostered on both.
      expect(h.eventKeys()).toEqual(['bind-game:null']);
      expect(h.rosterOf('bind-game:null')).toEqual(['u1', 'u2']);
    });

    it('still reaches suppression on that join (must not re-break ROK-959)', async () => {
      await degradedEventThenAllConfirmed();
      h.mocks.adHocEventService.trySuppressForScheduled.mockClear();

      await h.joinMember({ id: 'bot9', ...BOUND_GAME, bot: true });

      expect(
        h.mocks.adHocEventService.trySuppressForScheduled,
      ).toHaveBeenCalled();
    });
  });

  // ─── Review LOW-1: recovery must dispatch bots too ────────────────────────

  describe('LOW-1 — bot present at startup recovery', () => {
    it('dispatches the bot so suppression runs on bot restart', async () => {
      h = await setupRok1445Harness(gameBinding());
      // Seed the channel BEFORE connect so recovery walks it.
      h.channelMembers.set('bot9', {
        id: 'bot9',
        displayName: 'bot9',
        user: { username: 'bot9', avatar: null, bot: true },
        presence: null,
        voice: { channelId: CHANNEL_ID },
      });
      h.mocks.adHocEventService.trySuppressForScheduled.mockClear();

      await h.listener.onBotConnected();

      expect(
        h.mocks.adHocEventService.trySuppressForScheduled,
      ).toHaveBeenCalled();
    });

    it('still keeps that bot out of channel occupancy', async () => {
      h = await setupRok1445Harness(gameBinding());
      h.channelMembers.set('bot9', {
        id: 'bot9',
        displayName: 'bot9',
        user: { username: 'bot9', avatar: null, bot: true },
        presence: null,
        voice: { channelId: CHANNEL_ID },
      });

      await h.listener.onBotConnected();

      expect(occupancy(h)).toEqual([]);
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

    // ─── Review LOW-2: an unresolvable channel must cancel NOTHING ─────────

    it('keeps pending spawns armed when the channel cannot be resolved', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u3', ...DEEP_ROCK });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.joinMember({ id: 'u4', ...DEEP_ROCK });
      expect(h.spawnTimerKeys()).toHaveLength(2);

      // Simulate a Discord cache miss: the guild no longer resolves the
      // channel, so group membership is unknowable at leave time.
      h.mocks.clientService.getClient.mockReturnValue({
        on: jest.fn(),
        removeListener: jest.fn(),
        guilds: { cache: new Collection() },
      });
      await h.leaveMember('u1');

      // Cancelling all of them would strand both groups with nothing to
      // re-arm the timers until a fresh join.
      expect(h.spawnTimerKeys()).toHaveLength(2);
    });

    it('does not buffer game activity for a bot', async () => {
      h = await setupRok1445Harness(lobbyBinding());

      await h.joinMember({ id: 'bot9', ...COD4, bot: true });

      expect(h.mocks.gameActivityService.bufferStart).not.toHaveBeenCalled();
    });
  });
});

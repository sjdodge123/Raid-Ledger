/**
 * ROK-1446 D6 — the five voice hooks that mark a bound `general-lobby` channel
 * dirty for `ChannelPresenceEmbedService`.
 *
 * Four of the five live in the voice pipeline and are pinned here: join
 * (`dispatchLobbyJoin`), leave (`handleChannelLeave`), the game-switch path
 * (`handlePresenceChange`) and restart recovery (`recoverChannel`). The fifth
 * (`AdHocNotificationService.notifySpawn`, D9) has no voice event and is pinned
 * by its own spec.
 *
 * Two invariants this file exists to hold, both of which have a cheap way to go
 * wrong:
 *
 * 1. **Lobby-scoped.** A `game-voice-monitor` binding must NEVER mark a channel
 *    dirty — those channels keep the unchanged ROK-1447 per-event card (D1). A
 *    hook wired to the shared dispatch instead of the lobby branch would render
 *    a presence embed over a monitor channel and double-announce every spawn.
 * 2. **Exactly once per room change.** `markDirty` is idempotent by design, but
 *    a hook placed inside a per-member loop would still turn one restart into N
 *    renders, and the count is the only thing that catches it.
 *
 * Ordering: `recover()` must RESOLVE before recovery dispatches its first join.
 * Recovery re-seats the whole room, so a join that lands before the open row has
 * been adopted posts a SECOND message for a room that already has one.
 */
import {
  CHANNEL_ID,
  gameBinding,
  lobbyBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const FFXIV = { gameId: 1, gameName: 'Final Fantasy XIV' };
const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };

describe('VoiceStateListener — ROK-1446 channel-presence hooks (D6)', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  // ─── general-lobby: every room change marks the channel exactly once ──────

  describe('general-lobby binding', () => {
    it('marks the channel dirty exactly once when a member joins', async () => {
      h = await setupRok1445Harness(lobbyBinding());

      await h.joinMember({ id: 'u1', ...FFXIV });

      expect(h.markDirtyCalls()).toEqual([CHANNEL_ID]);
    });

    it('marks the channel dirty exactly once when a member leaves', async () => {
      h = await setupRok1445Harness(lobbyBinding());
      await h.joinMember({ id: 'u1', ...FFXIV });
      h.mocks.channelPresence.markDirty.mockClear();

      await h.leaveMember('u1');

      expect(h.markDirtyCalls()).toEqual([CHANNEL_ID]);
    });

    it('marks the channel dirty exactly once when a member switches game', async () => {
      h = await setupRok1445Harness(lobbyBinding());
      await h.joinMember({ id: 'u1', ...FFXIV });
      h.mocks.channelPresence.markDirty.mockClear();

      await h.changePresence('u1', COD4);

      expect(h.markDirtyCalls()).toEqual([CHANNEL_ID]);
    });

    /**
     * Two members already in the room at bot-connect produce exactly three
     * marks: one per re-dispatched join plus ONE for the channel itself. Four
     * would mean the recovery hook sits inside `recoverChannel`'s member loop —
     * one restart, N renders.
     */
    it('marks the channel dirty once per channel on restart recovery', async () => {
      h = await setupRok1445Harness(lobbyBinding(), [
        { id: 'u1', ...FFXIV },
        { id: 'u2', ...FFXIV },
      ]);

      expect(h.markDirtyCalls()).toEqual([CHANNEL_ID, CHANNEL_ID, CHANNEL_ID]);
    });
  });

  // ─── game-voice-monitor: D1 keeps the ROK-1447 per-event card ─────────────

  describe('game-voice-monitor binding', () => {
    it('never marks a channel dirty on join', async () => {
      h = await setupRok1445Harness(gameBinding());

      await h.joinMember({ id: 'u1', ...FFXIV });
      await h.joinMember({ id: 'u2', ...FFXIV });

      expect(h.markDirtyCalls()).toEqual([]);
    });

    it('never marks a channel dirty on leave', async () => {
      h = await setupRok1445Harness(gameBinding());
      await h.joinMember({ id: 'u1', ...FFXIV });

      await h.leaveMember('u1');

      expect(h.markDirtyCalls()).toEqual([]);
    });

    it('never marks a channel dirty on restart recovery', async () => {
      h = await setupRok1445Harness(gameBinding(), [
        { id: 'u1', ...FFXIV },
        { id: 'u2', ...FFXIV },
      ]);

      expect(h.markDirtyCalls()).toEqual([]);
    });
  });

  // ─── listener lifecycle: recover() before recovery, clear() on disconnect ──

  describe('bot lifecycle', () => {
    it('resolves recover() before recovery dispatches its first join', async () => {
      h = await setupRok1445Harness(lobbyBinding(), [
        { id: 'u1', ...FFXIV },
        { id: 'u2', ...FFXIV },
      ]);

      expect(h.mocks.channelPresence.recover).toHaveBeenCalledTimes(1);
      expect(h.recoverResolvedBeforeFirstJoin()).toBe(true);
    });

    it('clears in-memory presence state when the bot disconnects', async () => {
      h = await setupRok1445Harness(lobbyBinding());

      h.listener.onBotDisconnected();

      expect(h.mocks.channelPresence.clear).toHaveBeenCalledTimes(1);
    });
  });
});

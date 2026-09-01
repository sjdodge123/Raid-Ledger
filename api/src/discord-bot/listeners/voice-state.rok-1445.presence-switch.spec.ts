/**
 * ROK-1445 — the presence-change path (`handlePresenceChange` → `moveToNewGame`)
 * has NO threshold gate at all: one member switching game mints a brand-new
 * 1-person event for the game they switched to, whatever `minPlayers` says.
 *
 * This is AC16(b), the second named regression case, plus the AC3/AC6 rules
 * that constrain the fix:
 *   - AC3  a NEW event needs the group to clear `minPlayers`;
 *          joining an EXISTING event stays unconditional.
 *   - AC6  a dropped switch must still record game activity.
 *   - AC10 the drop emits a `group-below-threshold` gate trace.
 */
import {
  BINDING_ID,
  lobbyBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const FFXIV = { gameId: 1, gameName: 'Final Fantasy XIV' };
const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };

describe('VoiceStateListener — ROK-1445 presence-switch spawn gate', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  /** Two members on FFXIV clear minPlayers=2 and hold one live event. */
  async function twoOnFfxiv(): Promise<void> {
    h = await setupRok1445Harness(lobbyBinding({ config: { minPlayers: 2 } }));
    await h.joinMember({ id: 'u1', ...FFXIV });
    await h.joinMember({ id: 'u2', ...FFXIV });
    await h.advanceSpawnDelay();
    h.mocks.adHocEventService.handleVoiceJoin.mockClear();
    h.mocks.gameActivityService.bufferStart.mockClear();
  }

  // ─── AC16(b) — the second named regression case ───────────────────────────

  describe('AC16(b) — one member switches to a game nobody else plays', () => {
    it('mints NO new 1-person event for the switched-to game [must-fail-now]', async () => {
      await twoOnFfxiv();

      await h.changePresence('u2', COD4);

      expect(h.eventKeys()).not.toContain(`${BINDING_ID}:${COD4.gameId}`);
      expect(h.joinCalls()).toEqual([]);
    });

    it('still records the switched-to game as voice activity (AC6) [must-fail-now]', async () => {
      await twoOnFfxiv();

      await h.changePresence('u2', COD4);

      // Tracking is independent of the event: the drop costs the event, never
      // the play-time record.
      expect(h.mocks.gameActivityService.bufferStart).toHaveBeenCalledWith(
        expect.any(Number),
        COD4.gameName,
        expect.any(Date),
        'voice',
      );
      expect(h.joinCalls()).toEqual([]);
    });

    it('emits a group-below-threshold gate trace for the refused switch (AC10) [must-fail-now]', async () => {
      await twoOnFfxiv();

      await h.changePresence('u2', COD4);

      expect(h.gateLines().join('\n')).toContain(
        'outcome=group-below-threshold',
      );
    });
  });

  // ─── AC3 — joining an EXISTING event stays unconditional ──────────────────

  describe('AC3 — switching into a game that already has a live event', () => {
    it('joins the existing event even though the switcher is alone in it [must-keep-passing]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...FFXIV });
      await h.joinMember({ id: 'u2', ...FFXIV });
      await h.joinMember({ id: 'u3', ...COD4 });
      await h.joinMember({ id: 'u4', ...COD4 });
      await h.advanceSpawnDelay();
      expect(h.eventKeys()).toContain(`${BINDING_ID}:${COD4.gameId}`);
      h.mocks.adHocEventService.handleVoiceJoin.mockClear();

      await h.changePresence('u2', COD4);

      expect(h.joinCalls()).toEqual([
        expect.objectContaining({
          bindingId: BINDING_ID,
          memberId: 'u2',
          gameId: COD4.gameId,
        }),
      ]);
      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual([
        'u2',
        'u3',
        'u4',
      ]);
    });
  });

  // ─── Preservation — presence going null with Just Chatting off ────────────

  describe('presence resolves to no game, allowJustChatting off', () => {
    it('removes the member from their event and mints nothing [must-keep-passing]', async () => {
      await twoOnFfxiv();

      await h.changePresence('u2', { gameId: null, gameName: 'Nothing' });

      expect(h.mocks.adHocEventService.handleVoiceLeave).toHaveBeenCalledWith(
        BINDING_ID,
        'u2',
      );
      expect(h.joinCalls()).toEqual([]);
    });
  });
});

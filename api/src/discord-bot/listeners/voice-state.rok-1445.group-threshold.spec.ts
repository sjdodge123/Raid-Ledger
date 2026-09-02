/**
 * ROK-1445 — general-lobby Quick Play events must evaluate `minPlayers` against
 * the GAME GROUP that will populate the roster, never channel occupancy.
 *
 * Every `it` below is tagged with the AC it pins and whether it is expected to
 * FAIL before the fix (behaviour change) or PASS both before and after
 * (preservation guard). Do not "fix" a preservation guard by weakening it.
 *
 *   AC16(a) must-fail-now   AC2 must-fail-now   AC5 must-fail-now
 *   AC7     must-fail-now   AC8 must-fail-now   AC9 must-fail-now
 *   AC10    must-fail-now   AC8b must-keep-passing   AC11 must-keep-passing
 */
import {
  BINDING_ID,
  lobbyBinding,
  rosterFor,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };
const DEEP_ROCK = { gameId: 9, gameName: 'Deep Rock Galactic' };

describe('VoiceStateListener — ROK-1445 per-group minPlayers (general lobby)', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  // ─── AC16(a) — the headline regression ────────────────────────────────────

  describe('AC16(a) — 2 members on 2 different games, minPlayers = 2', () => {
    it('mints NO event: neither one-person group clears the threshold [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );

      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...DEEP_ROCK });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([]);
      expect(h.joinCalls()).toEqual([]);
    });
  });

  // ─── AC2 — every qualifying group spawns its own event ────────────────────

  describe('AC2 — 3 on CoD4 + 2 on Deep Rock, minPlayers = 2', () => {
    async function fillTwoQualifyingGroups(): Promise<void> {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.joinMember({ id: 'u3', ...COD4 });
      await h.joinMember({ id: 'u4', ...DEEP_ROCK });
      await h.joinMember({ id: 'u5', ...DEEP_ROCK });
      await h.advanceSpawnDelay();
    }

    it('mints two concurrent events, one per qualifying group [must-fail-now]', async () => {
      await fillTwoQualifyingGroups();

      expect(h.eventKeys().sort()).toEqual(
        [
          `${BINDING_ID}:${COD4.gameId}`,
          `${BINDING_ID}:${DEEP_ROCK.gameId}`,
        ].sort(),
      );
    });

    it('keeps each roster to its own group — no cross-attribution [must-fail-now]', async () => {
      await fillTwoQualifyingGroups();

      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual([
        'u1',
        'u2',
        'u3',
      ]);
      expect(h.rosterOf(`${BINDING_ID}:${DEEP_ROCK.gameId}`)).toEqual([
        'u4',
        'u5',
      ]);
    });
  });

  // ─── AC5 — sub-threshold groups are DROPPED, never folded ─────────────────

  describe('AC5 — 3 on CoD4 + 1 on Deep Rock, minPlayers = 2', () => {
    async function fillOneQualifyingOneShort(): Promise<void> {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.joinMember({ id: 'u3', ...COD4 });
      await h.joinMember({ id: 'u4', ...DEEP_ROCK });
      await h.advanceSpawnDelay();
    }

    it('spawns only the qualifying group, holding only its own members [must-fail-now]', async () => {
      await fillOneQualifyingOneShort();

      expect(h.eventKeys()).toEqual([`${BINDING_ID}:${COD4.gameId}`]);
      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual([
        'u1',
        'u2',
        'u3',
      ]);
    });

    it('never rosters the lone Deep Rock player anywhere [must-fail-now]', async () => {
      await fillOneQualifyingOneShort();

      expect(h.joinCalls().map((c) => c.memberId)).not.toContain('u4');
    });

    it('emits a group-below-threshold gate trace for the dropped group (AC10) [must-fail-now]', async () => {
      await fillOneQualifyingOneShort();

      expect(h.gateLines().join('\n')).toContain(
        'outcome=group-below-threshold',
      );
    });

    it('still records game activity for the dropped player (AC6) [must-fail-now]', async () => {
      await fillOneQualifyingOneShort();

      // The event is dropped; the play-time record is NOT.
      expect(h.mocks.gameActivityService.bufferStart).toHaveBeenCalledWith(
        expect.any(Number),
        DEEP_ROCK.gameName,
        expect.any(Date),
        'voice',
      );
      expect(h.joinCalls().map((c) => c.memberId)).not.toContain('u4');
    });
  });

  // ─── AC7 — presence-nulls excluded from counts and rosters ────────────────

  describe('AC7 — presence-null members, allowJustChatting off', () => {
    // Join order matters: an invisible member between the two CoD4 players
    // breaks `shouldSpawnImmediately`'s unanimity check, which is what forces
    // the delayed fan-out where `mergeNoGameIntoLargest` does the folding.
    it('excludes the null member from the CoD4 roster [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u3', gameId: null });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.advanceSpawnDelay();

      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1', 'u2']);
      expect(h.joinCalls().map((c) => c.memberId)).not.toContain('u3');
    });

    it('does not let two nulls carry a lone detected player over the line [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u2', gameId: null });
      await h.joinMember({ id: 'u3', gameId: null });
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([]);
    });
  });

  // ─── AC8 — allowJustChatting is its own group, same threshold ─────────────

  describe('AC8 — allowJustChatting', () => {
    it('drops a one-person Just Chatting group while CoD4 still spawns [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2, allowJustChatting: true } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.joinMember({ id: 'u3', gameId: null });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([`${BINDING_ID}:${COD4.gameId}`]);
      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1', 'u2']);
    });

    it('still spawns one Just Chatting event for 3 idlers [must-keep-passing]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2, allowJustChatting: true } }),
      );
      await h.joinMember({ id: 'u1', gameId: null });
      await h.joinMember({ id: 'u2', gameId: null });
      await h.joinMember({ id: 'u3', gameId: null });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([`${BINDING_ID}:null`]);
      expect(h.rosterOf(`${BINDING_ID}:null`)).toEqual(['u1', 'u2', 'u3']);
      expect(rosterFor(h.joinCalls(), null)).toEqual(['u1', 'u2', 'u3']);
    });
  });

  // ─── AC9 — bots filtered from counts AND rosters ──────────────────────────

  describe('AC9 — bots', () => {
    it('does not let a bot on the same game push a lone human over minPlayers [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'bot9', ...COD4, bot: true });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([]);
      expect(h.joinCalls().map((c) => c.memberId)).not.toContain('bot9');
    });

    it('keeps a bot out of a qualifying group roster [must-fail-now]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 2 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...COD4 });
      await h.joinMember({ id: 'bot9', ...COD4, bot: true });
      await h.advanceSpawnDelay();

      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1', 'u2']);
    });
  });

  // ─── AC11 — minPlayers must stay honoured in BOTH directions ──────────────

  describe('AC11 — minPlayers = 1', () => {
    it('still spawns a single-member event [must-keep-passing]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 1 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([`${BINDING_ID}:${COD4.gameId}`]);
      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1']);
    });

    it('spawns one event per solo player when two play different games [must-keep-passing]', async () => {
      h = await setupRok1445Harness(
        lobbyBinding({ config: { minPlayers: 1 } }),
      );
      await h.joinMember({ id: 'u1', ...COD4 });
      await h.joinMember({ id: 'u2', ...DEEP_ROCK });
      await h.advanceSpawnDelay();

      expect(h.eventKeys().sort()).toEqual(
        [
          `${BINDING_ID}:${COD4.gameId}`,
          `${BINDING_ID}:${DEEP_ROCK.gameId}`,
        ].sort(),
      );
      expect(h.rosterOf(`${BINDING_ID}:${COD4.gameId}`)).toEqual(['u1']);
      expect(h.rosterOf(`${BINDING_ID}:${DEEP_ROCK.gameId}`)).toEqual(['u2']);
    });
  });
});

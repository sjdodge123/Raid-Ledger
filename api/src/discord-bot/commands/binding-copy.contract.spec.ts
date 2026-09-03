/**
 * ROK-1462 (review nit 1) — the ROK-1448 help prose pinned as LITERALS.
 *
 * The web form tests only assert "the form renders the constant", so swapping
 * the `general-lobby` and `game-voice-monitor` entries of `MIN_PLAYERS_HELP`
 * kept every test green while telling an admin the exact inverse of the
 * ROK-697 / ROK-1445 semantics. This spec pins the SEMANTIC half of that copy:
 *
 * - General Lobby  -> minimum players on the SAME DETECTED GAME; members whose
 *   game Discord cannot see do NOT count.
 * - Game voice monitor -> minimum members IN THE CHANNEL; presence-null members
 *   DO count.
 *
 * api's jest maps `@raid-ledger/contract` to the contract SOURCE, so these
 * assertions fail the moment the source copy is inverted — no rebuild needed.
 */
import {
  AUTO_CLOSE_HELP,
  MIN_PLAYERS_CONSEQUENCE,
  MIN_PLAYERS_HELP,
} from '@raid-ledger/contract';

describe('MIN_PLAYERS_HELP (ROK-1448 / ROK-697 semantics)', () => {
  it('tells a General Lobby admin the threshold is per detected game', () => {
    const help = MIN_PLAYERS_HELP['general-lobby'];

    expect(help).toMatch(/per detected game/);
    expect(help).toMatch(/not per channel/);
    // Presence-null members do NOT count for a lobby unless Just Chatting is on.
    expect(help).toMatch(
      /not counted at all unless "Just Chatting" is allowed/,
    );
  });

  it('tells a voice-monitor admin the threshold is members in the channel', () => {
    const help = MIN_PLAYERS_HELP['game-voice-monitor'];

    expect(help).toMatch(/in the channel/);
    // Presence-null members DO count for a monitor — the inverse of the lobby.
    expect(help).toMatch(/including members whose game Discord cannot see/);
    expect(help).not.toMatch(/per detected game/);
  });

  it('says nothing for announcements, which has no threshold', () => {
    expect(MIN_PLAYERS_HELP['game-announcements']).toBe('');
  });
});

describe('MIN_PLAYERS_CONSEQUENCE (ROK-1448)', () => {
  it('keeps the worked five-people/three-games example', () => {
    expect(MIN_PLAYERS_CONSEQUENCE).toMatch(
      /five people across three games is\s+zero events/,
    );
    expect(MIN_PLAYERS_CONSEQUENCE).toMatch(/intended, not a fault/);
  });
});

describe('AUTO_CLOSE_HELP (ROK-1448)', () => {
  it('scopes closing to the event group, not the channel', () => {
    expect(AUTO_CLOSE_HELP).toMatch(/per event group, not per channel/);
    expect(AUTO_CLOSE_HELP).toMatch(
      /Other groups in the same\s+channel keep running/,
    );
  });
});

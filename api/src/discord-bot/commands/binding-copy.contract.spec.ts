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
  BINDING_PURPOSE_LABELS,
  MIN_PLAYERS_CONSEQUENCE,
  MIN_PLAYERS_HELP,
  classifyBindingTriple,
  deriveBindingPurpose,
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

/**
 * ROK-1471 (D4) — the LFG board is a forum purpose and ONLY a forum purpose.
 *
 * A forum bound to `game-announcements` would make the announcement router
 * post into a channel that only accepts threads; `lfg-board` on a text or
 * voice channel would make the board's thread-per-group posting impossible.
 * Both directions are rejected here so neither can be saved.
 */
describe('classifyBindingTriple — forum / lfg-board (ROK-1471)', () => {
  it('accepts a forum channel bound to the LFG board', () => {
    expect(classifyBindingTriple('forum', 'lfg-board', null)).toBeNull();
    expect(classifyBindingTriple('forum', 'lfg-board', 7)).toBeNull();
  });

  it('rejects any other purpose on a forum channel', () => {
    for (const purpose of [
      'game-announcements',
      'game-voice-monitor',
      'general-lobby',
    ] as const) {
      const violation = classifyBindingTriple('forum', purpose, 7);
      expect(violation?.code).toBe('BINDING_PURPOSE_WRONG_CHANNEL_TYPE');
      expect(violation?.field).toBe('bindingPurpose');
    }
  });

  it('rejects the LFG board on voice and on text channels', () => {
    for (const type of ['voice', 'text'] as const) {
      const violation = classifyBindingTriple(type, 'lfg-board', null);
      expect(violation?.code).toBe('BINDING_PURPOSE_WRONG_CHANNEL_TYPE');
      expect(violation?.message).toContain('forum channels use LFG board');
    }
  });

  it('leaves the pre-existing text/voice rules untouched', () => {
    expect(classifyBindingTriple('text', 'game-announcements', null)).toBeNull();
    expect(classifyBindingTriple('voice', 'general-lobby', null)).toBeNull();
    expect(classifyBindingTriple('voice', 'game-voice-monitor', 5)).toBeNull();
    expect(classifyBindingTriple('voice', 'game-voice-monitor', null)?.code).toBe(
      'BINDING_MONITOR_REQUIRES_GAME',
    );
    expect(classifyBindingTriple('voice', 'game-announcements', 1)?.code).toBe(
      'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    );
  });
});

describe('deriveBindingPurpose — forum (ROK-1471)', () => {
  it('derives lfg-board for a forum, regardless of game', () => {
    expect(deriveBindingPurpose('forum', null)).toBe('lfg-board');
    expect(deriveBindingPurpose('forum', 0)).toBe('lfg-board');
    expect(deriveBindingPurpose('forum', 42)).toBe('lfg-board');
  });

  it('still derives the text/voice purposes unchanged', () => {
    expect(deriveBindingPurpose('text', null)).toBe('game-announcements');
    expect(deriveBindingPurpose('voice', null)).toBe('general-lobby');
    expect(deriveBindingPurpose('voice', 0)).toBe('game-voice-monitor');
  });
});

describe('binding copy covers the LFG board (ROK-1471)', () => {
  it('labels it and explains that the bot normally owns the channel', () => {
    expect(BINDING_PURPOSE_LABELS['lfg-board']).toBe('LFG board');
    expect(MIN_PLAYERS_HELP['lfg-board']).toMatch(
      /one thread per forming group/,
    );
    expect(MIN_PLAYERS_HELP['lfg-board']).toMatch(/bind one only to override/);
  });
});

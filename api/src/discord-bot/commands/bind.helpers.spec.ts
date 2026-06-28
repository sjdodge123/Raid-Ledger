import { shouldDeriveSeriesGame } from './bind.helpers';

/**
 * ROK-1372: a variety-series VOICE bind must not auto-derive a single game
 * (which would lock the channel to game-voice-monitor and mislabel every
 * quick-play, e.g. gamernight → HELLCARD). Text/announce binds still derive.
 */
describe('shouldDeriveSeriesGame (ROK-1372)', () => {
  it('does NOT derive a game for a voice bind with no explicit game', () => {
    // → gameId stays null → general-lobby (presence auto-detect)
    expect(shouldDeriveSeriesGame('voice', false)).toBe(false);
  });

  it('derives a game for a text/announce bind with no explicit game', () => {
    // announcements route by game, so derivation is intended
    expect(shouldDeriveSeriesGame('text', false)).toBe(true);
  });

  it('never derives when an explicit game was supplied (voice or text)', () => {
    expect(shouldDeriveSeriesGame('voice', true)).toBe(false);
    expect(shouldDeriveSeriesGame('text', true)).toBe(false);
  });
});

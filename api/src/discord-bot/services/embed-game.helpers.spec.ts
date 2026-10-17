/**
 * ROK-1460 — the shared games-row → `EmbedEventData['game']` projection.
 *
 * The embed title links to `/games/:id`, so every one of the five hydration
 * sites has to carry the game's id. One projection means a site cannot forget.
 */
import { toEmbedGame } from './embed-game.helpers';

describe('toEmbedGame', () => {
  it('carries the id the title link needs', () => {
    expect(toEmbedGame({ id: 7, name: 'Deep Rock', coverUrl: null })).toEqual({
      id: 7,
      name: 'Deep Rock',
      coverUrl: null,
    });
  });

  it('keeps the cover art for the thumbnail', () => {
    expect(
      toEmbedGame({ id: 9, name: 'WoW', coverUrl: 'https://x/y.jpg' })
        ?.coverUrl,
    ).toBe('https://x/y.jpg');
  });

  it('treats a missing cover as null rather than undefined', () => {
    expect(toEmbedGame({ id: 9, name: 'WoW' })?.coverUrl).toBeNull();
  });

  it('returns null for a gameless event', () => {
    expect(toEmbedGame(null)).toBeNull();
    expect(toEmbedGame(undefined)).toBeNull();
  });
});

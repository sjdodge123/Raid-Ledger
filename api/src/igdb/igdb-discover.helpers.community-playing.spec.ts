/**
 * Unit tests for pure helpers backing the "Community Has Been Playing"
 * discover row (ROK-565). DB behavior, SQL, and cache wiring are covered by
 * the integration spec (`igdb-discover.community-playing.integration.spec.ts`).
 */
import {
  buildDiscoverCategories,
  buildCommunityPlayingCategory,
} from './igdb-discover.helpers';
import {
  buildCommunityPlayingMetadata,
  type CommunityPlayingRow,
} from './igdb-discover-community-playing.helpers';

describe('buildCommunityPlayingCategory', () => {
  it('returns the "Your Community Has Been Playing" name + slug', () => {
    const cat = buildCommunityPlayingCategory();
    expect(cat.category).toBe('Your Community Has Been Playing');
    expect(cat.slug).toBe('community-has-been-playing');
  });

  it('marks the category as cached so dispatch routes through the bespoke fetcher', () => {
    expect(buildCommunityPlayingCategory().cached).toBe(true);
  });
});

describe('buildDiscoverCategories — community-has-been-playing placement', () => {
  it('appears at index 0, before community-wants-to-play', () => {
    const cats = buildDiscoverCategories();
    expect(cats[0].slug).toBe('community-has-been-playing');
    const wantsIdx = cats.findIndex(
      (c) => c.slug === 'community-wants-to-play',
    );
    expect(wantsIdx).toBeGreaterThan(0);
  });
});

describe('buildCommunityPlayingMetadata', () => {
  const row = (
    id: number,
    count: number,
    seconds: number,
  ): CommunityPlayingRow => ({
    game_id: id,
    player_count: count,
    total_seconds: String(seconds),
  });

  it('keys entries by stringified gameId and coerces total_seconds to number', () => {
    const rows = [row(42, 3, 9000), row(7, 1, 300)];
    const metadata = buildCommunityPlayingMetadata(rows, [42, 7]);
    expect(metadata['42']).toEqual({ playerCount: 3, totalSeconds: 9000 });
    expect(metadata['7']).toEqual({ playerCount: 1, totalSeconds: 300 });
  });

  it('omits rows whose gameId did not survive hydration (hidden/banned)', () => {
    const rows = [row(1, 2, 1000), row(2, 1, 500)];
    const metadata = buildCommunityPlayingMetadata(rows, [1]);
    expect(metadata['1']).toBeDefined();
    expect(metadata['2']).toBeUndefined();
  });

  it('returns an empty object when no rows qualify', () => {
    expect(buildCommunityPlayingMetadata([], [])).toEqual({});
  });

  it('parses bigint-as-text total_seconds safely for large numbers', () => {
    const rows = [row(99, 1, 2_000_000_000)];
    const metadata = buildCommunityPlayingMetadata(rows, [99]);
    expect(metadata['99'].totalSeconds).toBe(2_000_000_000);
    expect(typeof metadata['99'].totalSeconds).toBe('number');
  });
});

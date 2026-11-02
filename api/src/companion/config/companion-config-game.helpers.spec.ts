/** ROK-2067 D13 — `pickConfigGame`: variant rule + cover borrow. */
import {
  pickConfigGame,
  type ConfigGameRow,
} from './companion-config-game.helpers';

const SLUGS = ['wow', 'wow-classic', 'wow-forever'];
const row = (
  slug: string,
  hubs: number,
  coverUrl: string | null,
): ConfigGameRow => ({
  slug,
  name: `Name ${slug}`,
  coverUrl,
  hubs,
});

describe('pickConfigGame', () => {
  it('the slug with the most hubs wins over the primary', () => {
    const rows = [
      row('wow', 0, 'a'),
      row('wow-classic', 3, 'b'),
      row('wow-forever', 1, 'c'),
    ];
    expect(pickConfigGame(SLUGS, 'wow-forever', rows)).toEqual({
      slug: 'wow-classic',
      name: 'Name wow-classic',
      coverUrl: 'b',
    });
  });

  it('a tie or no hubs goes to the primary', () => {
    const tie = [row('wow', 2, 'a'), row('wow-forever', 2, 'c')];
    expect(pickConfigGame(SLUGS, 'wow-forever', tie)?.slug).toBe('wow-forever');
    const none = [row('wow', 0, 'a'), row('wow-forever', 0, 'c')];
    expect(pickConfigGame(SLUGS, 'wow-forever', none)?.slug).toBe(
      'wow-forever',
    );
  });

  it('a picked row without a cover borrows the first sibling cover in manifest order', () => {
    const rows = [
      row('wow-forever', 0, null),
      row('wow-classic', 0, 'b'),
      row('wow', 0, 'a'),
    ];
    expect(pickConfigGame(SLUGS, 'wow-forever', rows)).toEqual({
      slug: 'wow-forever',
      name: 'Name wow-forever',
      coverUrl: 'a',
    });
  });

  it('null with no rows; coverUrl null when no slug has a cover', () => {
    expect(pickConfigGame(SLUGS, 'wow-forever', [])).toBeNull();
    expect(
      pickConfigGame(SLUGS, 'wow', [row('wow', 0, null)])?.coverUrl,
    ).toBeNull();
  });
});

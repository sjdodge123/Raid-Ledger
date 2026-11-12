import { hubBackdropsOf } from './hubs.helpers';

const shot = (n: number): string =>
  `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${n}.jpg`;

describe('hubBackdropsOf', () => {
  it('takes the first https screenshot per hub game, else its https cover', () => {
    expect(
      hubBackdropsOf([
        { coverUrl: 'https://c/1.jpg', screenshots: [shot(1), shot(2)] },
        { coverUrl: 'https://c/2.jpg', screenshots: [] },
        { coverUrl: 'https://c/3.jpg', screenshots: null },
      ]),
    ).toEqual([shot(1), 'https://c/2.jpg', 'https://c/3.jpg']);
  });

  it('drops non-https art and duplicates, and caps at 4', () => {
    expect(
      hubBackdropsOf([
        {
          coverUrl: 'http://c/x.jpg',
          screenshots: ['//images.igdb.com/a.jpg'],
        },
        { coverUrl: null, screenshots: [shot(1)] },
        { coverUrl: null, screenshots: [shot(1)] },
        ...[2, 3, 4, 5].map((n) => ({
          coverUrl: null,
          screenshots: [shot(n)],
        })),
      ]),
    ).toEqual([shot(1), shot(2), shot(3), shot(4)]);
  });

  it('returns an empty list when no hub has art', () => {
    expect(hubBackdropsOf([])).toEqual([]);
  });
});

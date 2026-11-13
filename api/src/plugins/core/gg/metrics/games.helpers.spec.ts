import {
  buildTopGamesCard,
  summarizeHours,
  topGamePerMonth,
  totalsByGame,
  type GgRollupRow,
} from './games.helpers';

const row = (gameId: number, month: number, seconds: number): GgRollupRow => ({
  gameId,
  name: `Game ${gameId}`,
  coverUrl: null,
  month,
  seconds,
});

const ROWS: GgRollupRow[] = [
  row(1, 1, 100),
  row(2, 1, 300),
  row(1, 2, 500),
  row(3, 2, 500),
  row(2, 3, 0),
];

describe('totalsByGame', () => {
  it('sums seconds per game, largest first, ties to the smaller id', () => {
    expect(totalsByGame(ROWS).map((t) => [t.gameId, t.seconds])).toEqual([
      [1, 600],
      [3, 500],
      [2, 300],
    ]);
  });
});

describe('topGamePerMonth', () => {
  it('picks each month’s top game (tie → smaller id) and skips empty months', () => {
    expect(
      topGamePerMonth(ROWS).map((t) => [t.month, t.gameId, t.seconds]),
    ).toEqual([
      [1, 2, 300],
      [2, 1, 500],
    ]);
  });
});

describe('summarizeHours', () => {
  it('totals the year and adds the night-owl share when sessions exist', () => {
    expect(summarizeHours(ROWS, { sessions: 10, nightSessions: 3 })).toEqual({
      totalSeconds: 1400,
      gamesPlayed: 3,
      nightOwlShare: 0.3,
    });
  });

  it('omits the share without sessions and is null without playtime', () => {
    expect(summarizeHours(ROWS, { sessions: 0, nightSessions: 0 })).toEqual({
      totalSeconds: 1400,
      gamesPlayed: 3,
    });
    expect(summarizeHours([], { sessions: 4, nightSessions: 1 })).toBeNull();
  });
});

describe('buildTopGamesCard', () => {
  it('attaches https screenshots (max 4) and a valid trailer id per game', () => {
    const shots = [
      'http://x/a.jpg',
      ...[1, 2, 3, 4, 5].map((i) => `https://images.igdb.com/${i}.jpg`),
    ];
    const media = new Map([
      [
        1,
        {
          gameId: 1,
          screenshots: shots,
          videos: [{ name: 'T', videoId: 'dQw4w9WgXcQ' }],
        },
      ],
      [
        3,
        {
          gameId: 3,
          screenshots: [],
          videos: [{ name: 'bad', videoId: '<script>' }],
        },
      ],
    ]);
    const card = buildTopGamesCard(ROWS, media);
    expect(card?.games[0]).toEqual({
      gameId: 1,
      name: 'Game 1',
      coverUrl: null,
      seconds: 600,
      screenshots: shots.slice(1, 5),
      trailerVideoId: 'dQw4w9WgXcQ',
    });
    expect(card?.games[1]).toMatchObject({
      gameId: 3,
      screenshots: [],
      trailerVideoId: null,
    });
    expect(card?.games[2]).toMatchObject({
      gameId: 2,
      screenshots: [],
      trailerVideoId: null,
    });
    expect(card?.byMonth).toHaveLength(2);
  });

  it('is null when nothing was played', () => {
    expect(buildTopGamesCard([row(1, 1, 0)], new Map())).toBeNull();
  });
});

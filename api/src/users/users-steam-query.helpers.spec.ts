import {
  mergeActivityWithSteam,
  type DiscordActivityRow,
  type SteamPlaytimeRow,
} from './users-steam-query.helpers';

describe('mergeActivityWithSteam', () => {
  it('should return empty array when both inputs are empty', () => {
    const result = mergeActivityWithSteam([], [], 'all');
    expect(result).toEqual([]);
  });

  it('should return Discord-only games when no Steam data', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'Game A', coverUrl: '/a.jpg', totalSeconds: 3600 },
    ];
    const result = mergeActivityWithSteam(discordRows, [], 'all');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      gameId: 1,
      gameName: 'Game A',
      totalSeconds: 3600,
      isMostPlayed: true,
    });
  });

  it('should return Steam-only games when no Discord data', () => {
    const steamRows: SteamPlaytimeRow[] = [
      {
        gameId: 2,
        gameName: 'Game B',
        coverUrl: '/b.jpg',
        playtimeForever: 120,
        playtime2weeks: 10,
      },
    ];
    const result = mergeActivityWithSteam([], steamRows, 'all');
    expect(result).toHaveLength(1);
    // playtimeForever=120 minutes => 7200 seconds
    expect(result[0]).toMatchObject({
      gameId: 2,
      gameName: 'Game B',
      totalSeconds: 7200,
      isMostPlayed: true,
    });
  });

  it('should merge matching games by summing seconds (all time)', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'Game A', coverUrl: '/a.jpg', totalSeconds: 3600 },
    ];
    const steamRows: SteamPlaytimeRow[] = [
      {
        gameId: 1,
        gameName: 'Game A',
        coverUrl: '/a.jpg',
        playtimeForever: 60,
        playtime2weeks: null,
      },
    ];
    const result = mergeActivityWithSteam(discordRows, steamRows, 'all');
    expect(result).toHaveLength(1);
    // 3600 + 60*60 = 7200
    expect(result[0].totalSeconds).toBe(7200);
  });

  it('should use playtime2weeks for week/month periods', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'Game A', coverUrl: '/a.jpg', totalSeconds: 1800 },
    ];
    const steamRows: SteamPlaytimeRow[] = [
      {
        gameId: 1,
        gameName: 'Game A',
        coverUrl: '/a.jpg',
        playtimeForever: 1000,
        playtime2weeks: 30,
      },
    ];
    const result = mergeActivityWithSteam(discordRows, steamRows, 'week');
    // 1800 + 30*60 = 3600
    expect(result[0].totalSeconds).toBe(3600);
  });

  it('should treat null playtime2weeks as 0 for non-all periods', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'Game A', coverUrl: '/a.jpg', totalSeconds: 500 },
    ];
    const steamRows: SteamPlaytimeRow[] = [
      {
        gameId: 1,
        gameName: 'Game A',
        coverUrl: '/a.jpg',
        playtimeForever: 100,
        playtime2weeks: null,
      },
    ];
    const result = mergeActivityWithSteam(discordRows, steamRows, 'month');
    // null playtime2weeks => 0 contribution
    expect(result[0].totalSeconds).toBe(500);
  });

  it('should sort by totalSeconds descending', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'Low', coverUrl: null, totalSeconds: 100 },
      { gameId: 2, gameName: 'High', coverUrl: null, totalSeconds: 9999 },
    ];
    const result = mergeActivityWithSteam(discordRows, [], 'all');
    expect(result[0].gameName).toBe('High');
    expect(result[1].gameName).toBe('Low');
  });

  it('should mark only the first entry as isMostPlayed', () => {
    const discordRows: DiscordActivityRow[] = [
      { gameId: 1, gameName: 'A', coverUrl: null, totalSeconds: 100 },
      { gameId: 2, gameName: 'B', coverUrl: null, totalSeconds: 200 },
    ];
    const result = mergeActivityWithSteam(discordRows, [], 'all');
    expect(result[0].isMostPlayed).toBe(true);
    expect(result[1].isMostPlayed).toBe(false);
  });

  it('should limit output to 20 entries', () => {
    const discordRows: DiscordActivityRow[] = Array.from(
      { length: 25 },
      (_, i) => ({
        gameId: i + 1,
        gameName: `Game ${i}`,
        coverUrl: null,
        totalSeconds: 25 - i,
      }),
    );
    const result = mergeActivityWithSteam(discordRows, [], 'all');
    expect(result).toHaveLength(20);
  });

  it('should include Steam-only games alongside Discord games', () => {
    const discordRows: DiscordActivityRow[] = [
      {
        gameId: 1,
        gameName: 'Discord Only',
        coverUrl: null,
        totalSeconds: 500,
      },
    ];
    const steamRows: SteamPlaytimeRow[] = [
      {
        gameId: 2,
        gameName: 'Steam Only',
        coverUrl: null,
        playtimeForever: 100,
        playtime2weeks: null,
      },
    ];
    const result = mergeActivityWithSteam(discordRows, steamRows, 'all');
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.gameName);
    expect(names).toContain('Discord Only');
    expect(names).toContain('Steam Only');
  });
});

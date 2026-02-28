import { Test, TestingModule } from '@nestjs/testing';
import { ActivityType } from 'discord.js';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Build a minimal GuildMember-like object for testing. */
function makeMember(
  id: string,
  activityName?: string,
  activityType: ActivityType = ActivityType.Playing,
): object {
  return {
    id,
    presence: activityName
      ? {
          activities: [{ type: activityType, name: activityName }],
        }
      : null,
  };
}

describe('PresenceGameDetectorService', () => {
  let service: PresenceGameDetectorService;

  // Use a custom mock to control .limit() return values per query step
  let mockLimitFn: jest.Mock;
  let mockDb: object;

  beforeEach(async () => {
    mockLimitFn = jest.fn();

    // All select queries resolve through .limit()
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: mockLimitFn,
    };

    mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceGameDetectorService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get(PresenceGameDetectorService);
  });

  // ─── Manual Override ───────────────────────────────────────────────────────

  describe('setManualOverride / getManualOverride', () => {
    it('returns the stored game name immediately after setting', () => {
      service.setManualOverride('user-1', 'World of Warcraft');

      expect(service.getManualOverride('user-1')).toBe('World of Warcraft');
    });

    it('returns null when no override has been set', () => {
      expect(service.getManualOverride('unknown-user')).toBeNull();
    });

    it('returns null after the 30-minute TTL expires', () => {
      jest.useFakeTimers();

      service.setManualOverride('user-ttl', 'Fortnite');
      expect(service.getManualOverride('user-ttl')).toBe('Fortnite');

      // Advance past 30 minutes
      jest.advanceTimersByTime(31 * 60 * 1000);

      expect(service.getManualOverride('user-ttl')).toBeNull();

      jest.useRealTimers();
    });

    it('is still valid just before the 30-minute mark', () => {
      jest.useFakeTimers();

      service.setManualOverride('user-almost', 'Minecraft');
      jest.advanceTimersByTime(29 * 60 * 1000);

      expect(service.getManualOverride('user-almost')).toBe('Minecraft');

      jest.useRealTimers();
    });
  });

  describe('clearManualOverride', () => {
    it('removes an existing override', () => {
      service.setManualOverride('user-clear', 'FFXIV');
      service.clearManualOverride('user-clear');

      expect(service.getManualOverride('user-clear')).toBeNull();
    });

    it('does not throw when clearing a non-existent override', () => {
      expect(() => service.clearManualOverride('ghost-user')).not.toThrow();
    });
  });

  // ─── resolveGame: game resolution pipeline ─────────────────────────────────

  describe('resolveGame', () => {
    it('resolves via discord_game_mappings (step 1)', async () => {
      // Mapping lookup returns a match
      mockLimitFn.mockResolvedValueOnce([{ gameId: 10, gameName: 'WoW' }]);

      const result = await service.resolveGame('World of Warcraft');

      expect(result).toEqual({ gameId: 10, gameName: 'WoW' });
    });

    it('resolves via exact games.name match (step 2) when no mapping', async () => {
      // Step 1: mapping lookup — no match
      mockLimitFn.mockResolvedValueOnce([]);
      // Step 2: exact match
      mockLimitFn.mockResolvedValueOnce([
        { id: 20, name: 'Final Fantasy XIV' },
      ]);

      const result = await service.resolveGame('Final Fantasy XIV');

      expect(result).toEqual({ gameId: 20, gameName: 'Final Fantasy XIV' });
    });

    it('resolves via ILIKE case-insensitive match (step 3)', async () => {
      // Step 1: mapping — no match
      mockLimitFn.mockResolvedValueOnce([]);
      // Step 2: exact — no match
      mockLimitFn.mockResolvedValueOnce([]);
      // Step 3: ILIKE match
      mockLimitFn.mockResolvedValueOnce([{ id: 30, name: 'Minecraft' }]);

      const result = await service.resolveGame('MINECRAFT');

      expect(result).toEqual({ gameId: 30, gameName: 'Minecraft' });
    });

    it('resolves via trigram similarity (step 4)', async () => {
      // Step 1, 2, 3: no match
      mockLimitFn.mockResolvedValueOnce([]);
      mockLimitFn.mockResolvedValueOnce([]);
      mockLimitFn.mockResolvedValueOnce([]);
      // Step 4: trigram
      mockLimitFn.mockResolvedValueOnce([{ id: 40, name: 'Fortnite' }]);

      const result = await service.resolveGame('Fortnight');

      expect(result).toEqual({ gameId: 40, gameName: 'Fortnite' });
    });

    it('falls back to activityName with null gameId when no match at all', async () => {
      // All steps: no match; trigram query also returns empty
      mockLimitFn.mockResolvedValueOnce([]); // mapping
      mockLimitFn.mockResolvedValueOnce([]); // exact
      mockLimitFn.mockResolvedValueOnce([]); // ilike
      mockLimitFn.mockResolvedValueOnce([]); // trigram

      const result = await service.resolveGame('SomeObscureGame123');

      expect(result).toEqual({
        gameId: null,
        gameName: 'SomeObscureGame123',
      });
    });

    it('caches resolved games so the DB is only queried once', async () => {
      mockLimitFn.mockResolvedValueOnce([{ gameId: 1, gameName: 'WoW' }]);

      // First call hits DB
      const first = await service.resolveGame('WoW');
      // Second call should use cache — no new DB queries
      const second = await service.resolveGame('WoW');

      expect(first).toEqual(second);
      // DB was only called once (for the first resolution)
      expect(mockLimitFn).toHaveBeenCalledTimes(1);
    });

    it('cache expires after 10 minutes', async () => {
      jest.useFakeTimers();

      mockLimitFn.mockResolvedValue([{ gameId: 1, gameName: 'WoW' }]);

      await service.resolveGame('WoW');

      // Advance past cache TTL
      jest.advanceTimersByTime(11 * 60 * 1000);

      await service.resolveGame('WoW');

      // DB should have been called again after expiry
      expect(mockLimitFn).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('falls back gracefully when pg_trgm extension throws', async () => {
      mockLimitFn.mockResolvedValueOnce([]); // mapping
      mockLimitFn.mockResolvedValueOnce([]); // exact
      mockLimitFn.mockResolvedValueOnce([]); // ilike
      mockLimitFn.mockRejectedValueOnce(new Error('pg_trgm not installed'));

      // Should not throw — returns activity name as fallback
      const result = await service.resolveGame('SomeGame');

      expect(result).toEqual({ gameId: null, gameName: 'SomeGame' });
    });
  });

  // ─── detectGameForMember ────────────────────────────────────────────────────

  describe('detectGameForMember', () => {
    it('returns resolved game when member has a Playing activity', async () => {
      mockLimitFn.mockResolvedValueOnce([{ gameId: 5, gameName: 'WoW' }]);

      const member = makeMember('user-1', 'World of Warcraft');
      const result = await service.detectGameForMember(member as any);

      expect(result).toMatchObject({ gameId: 5, gameName: 'WoW' });
    });

    it('returns Untitled Gaming Session when member has no activity', async () => {
      const member = makeMember('user-1');
      const result = await service.detectGameForMember(member as any);

      expect(result).toEqual({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
    });

    it('ignores non-Playing activity types', async () => {
      const member = {
        id: 'user-type',
        presence: {
          activities: [
            { type: ActivityType.Streaming, name: 'Twitch Stream' },
            { type: ActivityType.Listening, name: 'Spotify' },
          ],
        },
      };

      const result = await service.detectGameForMember(member as any);

      expect(result).toEqual({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
    });

    it('respects manual override over Rich Presence', async () => {
      service.setManualOverride('user-override', 'Minecraft');

      // resolveGame for 'Minecraft' → returns a matched game
      mockLimitFn.mockResolvedValueOnce([
        { gameId: 99, gameName: 'Minecraft' },
      ]);

      const member = makeMember('user-override', 'Fortnite'); // presence says Fortnite
      const result = await service.detectGameForMember(member as any);

      // Should use the manual override, not Fortnite from presence
      expect(result).toMatchObject({ gameName: 'Minecraft' });
    });

    it('handles null presence gracefully', async () => {
      const member = { id: 'user-null', presence: null };
      const result = await service.detectGameForMember(member as any);

      expect(result).toEqual({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
    });
  });

  // ─── detectGames: consensus algorithm ─────────────────────────────────────

  describe('detectGames', () => {
    it('returns empty array for empty members list', async () => {
      const result = await service.detectGames([]);
      expect(result).toEqual([]);
    });

    it('returns Untitled Gaming Session when all members have no activity', async () => {
      const members = [makeMember('u1'), makeMember('u2')];
      const result = await service.detectGames(members as any[]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        gameId: null,
        gameName: 'Untitled Gaming Session',
        memberIds: expect.arrayContaining(['u1', 'u2']),
      });
    });

    it('returns majority game when 50%+ play the same game', async () => {
      // u1, u2 play WoW, u3 plays Minecraft → WoW has majority (2/3 >= 50%)
      // resolveGame calls: u1-WoW (mapping hit), u2-WoW (cache), u3-Minecraft (mapping)
      mockLimitFn
        .mockResolvedValueOnce([{ gameId: 1, gameName: 'WoW' }]) // u1 mapping
        .mockResolvedValueOnce([{ gameId: 2, gameName: 'Minecraft' }]); // u3 mapping

      const members = [
        makeMember('u1', 'WoW'),
        makeMember('u2', 'WoW'), // will use cache from u1
        makeMember('u3', 'Minecraft'),
      ];

      const result = await service.detectGames(members as any[]);

      // Majority → all members assigned to WoW
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        gameId: 1,
        gameName: 'WoW',
        memberIds: expect.arrayContaining(['u1', 'u2', 'u3']),
      });
    });

    it('splits into separate groups when no majority exists (3+ members)', async () => {
      // 3 members: u1 WoW, u2 FFXIV, u3 Minecraft — no game has 50%+ (1/3 each)
      mockLimitFn
        .mockResolvedValueOnce([{ gameId: 1, gameName: 'WoW' }]) // u1
        .mockResolvedValueOnce([{ gameId: 2, gameName: 'FFXIV' }]) // u2
        .mockResolvedValueOnce([{ gameId: 3, gameName: 'Minecraft' }]); // u3

      const members = [
        makeMember('u1', 'WoW'),
        makeMember('u2', 'FFXIV'),
        makeMember('u3', 'Minecraft'),
      ];

      const result = await service.detectGames(members as any[]);

      // No game has 50%+ — should split into 3 groups
      expect(result.length).toBeGreaterThanOrEqual(2);
      const gameIds = result.map((g) => g.gameId);
      expect(gameIds).toContain(1);
      expect(gameIds).toContain(2);
      expect(gameIds).toContain(3);
    });

    it('assigns no-game members to the largest game group on split', async () => {
      // u1 plays WoW (gameId 1), u2 plays WoW (gameId 1), u3 has no game
      // But 2/3 WoW < majority because of how the threshold works...
      // Actually 2/3 = 66.7% which IS majority — let's use 4 members with 2 different games
      // u1,u2 → WoW; u3 → FFXIV; u4 → no game
      // No majority → split. u4 (no game) should go to WoW (largest group)
      mockLimitFn
        .mockResolvedValueOnce([{ gameId: 1, gameName: 'WoW' }]) // u1
        .mockResolvedValueOnce([{ gameId: 3, gameName: 'FFXIV' }]); // u3; u2 WoW cached

      const members = [
        makeMember('u1', 'WoW'),
        makeMember('u2', 'WoW'),
        makeMember('u3', 'FFXIV'),
        makeMember('u4'), // no game
      ];

      const result = await service.detectGames(members as any[]);

      // u1+u2 = WoW, u3 = FFXIV → 2/4 each = no majority → split
      // u4 (no game) goes to largest game group (WoW)
      const wowGroup = result.find((g) => g.gameId === 1);
      expect(wowGroup).toBeDefined();
      expect(wowGroup?.memberIds).toContain('u4');
    });

    it('respects manual overrides during group detection', async () => {
      service.setManualOverride('u1', 'Minecraft');

      // u1 manual override: Minecraft. u2 has no activity.
      mockLimitFn.mockResolvedValueOnce([
        { gameId: 5, gameName: 'Minecraft' },
      ]); // resolve 'Minecraft' for u1

      const members = [
        makeMember('u1', 'WoW'), // presence says WoW but manual override wins
        makeMember('u2'), // no game
      ];

      const result = await service.detectGames(members as any[]);

      // u1 has Minecraft override (gameId 5), u2 has null → Minecraft is majority (1/2 = 50%)
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ gameId: 5, gameName: 'Minecraft' });
    });

    it('majority check requires 50%+ AND a non-null gameId', async () => {
      // Even if 100% of members have null gameId, it should return Untitled
      // (not a "majority game" since gameId is null)
      const members = [makeMember('u1'), makeMember('u2'), makeMember('u3')];

      const result = await service.detectGames(members as any[]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        gameId: null,
        gameName: 'Untitled Gaming Session',
        memberIds: expect.arrayContaining(['u1', 'u2', 'u3']),
      });
    });

    it('single member with game returns that game', async () => {
      mockLimitFn.mockResolvedValueOnce([{ gameId: 7, gameName: 'Dota 2' }]);

      const members = [makeMember('u1', 'Dota 2')];
      const result = await service.detectGames(members as any[]);

      // 1 member, gameId not null → majority (1/1 = 100%)
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ gameId: 7, gameName: 'Dota 2' });
      expect(result[0].memberIds).toContain('u1');
    });
  });
});

/**
 * ROK-2204 — launcher presences (CurseForge, Battle.net, …) are not games.
 * They must never be matched against the games registry nor logged as an
 * unknown game; a real game shown alongside the launcher still wins.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityType, type GuildMember } from 'discord.js';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { isLauncherActivity } from './presence-launcher-activities';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

const UNTITLED = { gameId: null, gameName: 'Untitled Gaming Session' };

/** A GuildMember-shaped object with the given Playing activity names. */
function memberPlaying(id: string, ...names: string[]): GuildMember {
  const activities = names.map((name) => ({
    type: ActivityType.Playing,
    name,
  }));
  return { id, presence: { activities } } as unknown as GuildMember;
}

describe('isLauncherActivity', () => {
  it.each(['CurseForge', 'curseforge', '  CurseForge ', 'Battle.net'])(
    'treats "%s" as a launcher',
    (name) => {
      expect(isLauncherActivity(name)).toBe(true);
    },
  );

  it.each(['World of Warcraft', 'Valheim', 'CurseForge Quest', ''])(
    'does not treat "%s" as a launcher',
    (name) => {
      expect(isLauncherActivity(name)).toBe(false);
    },
  );
});

describe('PresenceGameDetectorService — launcher presences (ROK-2204)', () => {
  let service: PresenceGameDetectorService;
  let mockLimitFn: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockLimitFn = jest.fn().mockResolvedValue([]);
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: mockLimitFn,
    };
    const mockDb = { select: jest.fn().mockReturnValue(selectChain) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceGameDetectorService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();
    service = module.get(PresenceGameDetectorService);
    warnSpy = jest.spyOn(service['logger'], 'warn');
  });

  it('resolveGame("CurseForge") is no game, queries nothing, warns nothing', async () => {
    const result = await service.resolveGame('CurseForge');

    expect(result).toEqual(UNTITLED);
    expect(mockLimitFn).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a member playing only CurseForge is detected as no game', async () => {
    const result = await service.detectGameForMember(
      memberPlaying('u1', 'CurseForge'),
    );

    expect(result).toEqual(UNTITLED);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a real game listed after CurseForge is the one resolved', async () => {
    mockLimitFn.mockResolvedValueOnce([{ gameId: 7, gameName: 'Valheim' }]);
    const resolveSpy = jest.spyOn(service, 'resolveGame');

    const result = await service.detectGameForMember(
      memberPlaying('u1', 'CurseForge', 'Valheim'),
    );

    expect(resolveSpy.mock.calls).toEqual([['Valheim']]);
    expect(result).toEqual({ gameId: 7, gameName: 'Valheim' });
  });

  it('detectGames puts a CurseForge-only member in the no-game group', async () => {
    const result = await service.detectGames([
      memberPlaying('u1', 'CurseForge'),
    ]);

    expect(result).toEqual([{ ...UNTITLED, memberIds: ['u1'] }]);
    expect(mockLimitFn).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

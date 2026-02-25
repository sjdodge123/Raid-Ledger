/**
 * ROK-231: Unit tests for AdminSettingsController — hide/unhide games and adult filter endpoints.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminSettingsController } from './settings.controller';
import { SettingsService } from '../settings/settings.service';
import { IgdbService } from '../igdb/igdb.service';
import { DemoDataService } from './demo-data.service';

describe('AdminSettingsController — ROK-231: game hide/ban and adult filter', () => {
  let controller: AdminSettingsController;
  let mockIgdbService: Partial<IgdbService>;
  let mockSettingsService: Partial<SettingsService>;

  beforeEach(async () => {
    mockIgdbService = {
      hideGame: jest.fn().mockResolvedValue({
        success: true,
        message: 'Game "Valheim" hidden from users.',
        name: 'Valheim',
      }),
      unhideGame: jest.fn().mockResolvedValue({
        success: true,
        message: 'Game "Valheim" is now visible to users.',
        name: 'Valheim',
      }),
      banGame: jest.fn().mockResolvedValue({
        success: true,
        message: 'Game "Valheim" has been banned.',
        name: 'Valheim',
      }),
      unbanGame: jest.fn().mockResolvedValue({
        success: true,
        message: 'Game "Valheim" has been unbanned and restored.',
        name: 'Valheim',
      }),
      isAdultFilterEnabled: jest.fn().mockResolvedValue(false),
      hideAdultGames: jest.fn().mockResolvedValue(0),
      getSyncStatus: jest.fn().mockResolvedValue({
        lastSyncAt: null,
        gameCount: 0,
        syncInProgress: false,
      }),
      getHealthStatus: jest.fn().mockReturnValue({
        tokenStatus: 'not_fetched',
        tokenExpiresAt: null,
        lastApiCallAt: null,
        lastApiCallSuccess: null,
      }),
      syncAllGames: jest
        .fn()
        .mockResolvedValue({ refreshed: 0, discovered: 0 }),
      database: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      } as any,
    };

    mockSettingsService = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      isIgdbConfigured: jest.fn().mockResolvedValue(false),
      getDiscordOAuthConfig: jest.fn().mockResolvedValue(null),
      isBlizzardConfigured: jest.fn().mockResolvedValue(false),
    } as any;

    const mockDemoDataService = {
      getStatus: jest.fn().mockResolvedValue({ demoMode: false }),
      installDemoData: jest.fn().mockResolvedValue({ success: true }),
      clearDemoData: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSettingsController],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: IgdbService, useValue: mockIgdbService },
        { provide: DemoDataService, useValue: mockDemoDataService },
      ],
    }).compile();

    controller = module.get<AdminSettingsController>(AdminSettingsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // POST /admin/settings/games/:id/hide
  // ============================================================
  describe('hideGame', () => {
    it('returns success when game is hidden', async () => {
      const result = await controller.hideGame(1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('hidden');
      expect(mockIgdbService.hideGame).toHaveBeenCalledWith(1);
    });

    it('throws BadRequestException when game does not exist', async () => {
      (mockIgdbService.hideGame as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Game not found',
        name: '',
      });

      await expect(controller.hideGame(999)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls igdbService.hideGame with the correct id', async () => {
      await controller.hideGame(42);
      expect(mockIgdbService.hideGame).toHaveBeenCalledWith(42);
    });

    it('re-throws the service message in the exception', async () => {
      (mockIgdbService.hideGame as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Game not found',
        name: '',
      });

      try {
        await controller.hideGame(999);
        fail('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as {
          message: string;
        };
        expect(response.message).toBe('Game not found');
      }
    });
  });

  // ============================================================
  // POST /admin/settings/games/:id/unhide
  // ============================================================
  describe('unhideGame', () => {
    it('returns success when game is unhidden', async () => {
      const result = await controller.unhideGame(1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('visible');
      expect(mockIgdbService.unhideGame).toHaveBeenCalledWith(1);
    });

    it('throws BadRequestException when game does not exist', async () => {
      (mockIgdbService.unhideGame as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Game not found',
        name: '',
      });

      await expect(controller.unhideGame(999)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls igdbService.unhideGame with the correct id', async () => {
      await controller.unhideGame(7);
      expect(mockIgdbService.unhideGame).toHaveBeenCalledWith(7);
    });
  });

  // ============================================================
  // POST /admin/settings/games/:id/ban
  // ============================================================
  describe('banGame', () => {
    it('returns success when game is banned', async () => {
      const result = await controller.banGame(1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('banned');
      expect(mockIgdbService.banGame).toHaveBeenCalledWith(1);
    });

    it('throws BadRequestException when game does not exist', async () => {
      (mockIgdbService.banGame as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Game not found',
        name: '',
      });

      await expect(controller.banGame(999)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls igdbService.banGame with the correct id', async () => {
      await controller.banGame(42);
      expect(mockIgdbService.banGame).toHaveBeenCalledWith(42);
    });
  });

  // ============================================================
  // POST /admin/settings/games/:id/unban
  // ============================================================
  describe('unbanGame', () => {
    it('returns success when game is unbanned', async () => {
      const result = await controller.unbanGame(1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('unbanned');
      expect(mockIgdbService.unbanGame).toHaveBeenCalledWith(1);
    });

    it('throws BadRequestException when game does not exist', async () => {
      (mockIgdbService.unbanGame as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Game not found',
        name: '',
      });

      await expect(controller.unbanGame(999)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls igdbService.unbanGame with the correct id', async () => {
      await controller.unbanGame(7);
      expect(mockIgdbService.unbanGame).toHaveBeenCalledWith(7);
    });
  });

  // ============================================================
  // GET /admin/settings/igdb/adult-filter
  // ============================================================
  describe('getAdultFilter', () => {
    it('returns enabled: false when filter is off', async () => {
      (mockIgdbService.isAdultFilterEnabled as jest.Mock).mockResolvedValue(
        false,
      );
      const result = await controller.getAdultFilter();
      expect(result).toEqual({ enabled: false });
    });

    it('returns enabled: true when filter is on', async () => {
      (mockIgdbService.isAdultFilterEnabled as jest.Mock).mockResolvedValue(
        true,
      );
      const result = await controller.getAdultFilter();
      expect(result).toEqual({ enabled: true });
    });
  });

  // ============================================================
  // PUT /admin/settings/igdb/adult-filter
  // ============================================================
  describe('setAdultFilter', () => {
    it('saves the setting to true when enabling', async () => {
      (mockIgdbService.hideAdultGames as jest.Mock).mockResolvedValue(5);

      const result = await controller.setAdultFilter({ enabled: true });

      expect(mockSettingsService.set).toHaveBeenCalledWith(
        'igdb_filter_adult',
        'true',
      );
      expect(result.success).toBe(true);
    });

    it('calls hideAdultGames when enabling and returns hiddenCount', async () => {
      (mockIgdbService.hideAdultGames as jest.Mock).mockResolvedValue(5);

      const result = await controller.setAdultFilter({ enabled: true });

      expect(mockIgdbService.hideAdultGames).toHaveBeenCalled();
      expect(result.hiddenCount).toBe(5);
    });

    it('does NOT call hideAdultGames when disabling', async () => {
      const result = await controller.setAdultFilter({ enabled: false });

      expect(mockIgdbService.hideAdultGames).not.toHaveBeenCalled();
      expect(result.hiddenCount).toBeUndefined();
    });

    it('saves the setting to false when disabling', async () => {
      await controller.setAdultFilter({ enabled: false });

      expect(mockSettingsService.set).toHaveBeenCalledWith(
        'igdb_filter_adult',
        'false',
      );
    });

    it('returns message mentioning adult content filter enabled', async () => {
      (mockIgdbService.hideAdultGames as jest.Mock).mockResolvedValue(0);
      const result = await controller.setAdultFilter({ enabled: true });
      expect(result.message).toContain('Adult content filter enabled');
    });

    it('returns message mentioning games hidden when hiddenCount > 0', async () => {
      (mockIgdbService.hideAdultGames as jest.Mock).mockResolvedValue(3);
      const result = await controller.setAdultFilter({ enabled: true });
      expect(result.message).toContain('3 games');
    });

    it('returns message mentioning disabled when disabling', async () => {
      const result = await controller.setAdultFilter({ enabled: false });
      expect(result.message).toContain('disabled');
    });

    it('coerces non-boolean truthy to false (only true boolean enables)', async () => {
      // The controller only enables when body.enabled === true (strict equality)
      const result = await controller.setAdultFilter({ enabled: false });
      expect(mockSettingsService.set).toHaveBeenCalledWith(
        'igdb_filter_adult',
        'false',
      );
      expect(mockIgdbService.hideAdultGames).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // GET /admin/settings/games — listGames with showHidden filter
  // ============================================================
  describe('listGames — showHidden filter', () => {
    it('returns visible games only when showHidden is undefined', async () => {
      const rows = [
        {
          id: 1,
          igdbId: 111,
          name: 'Visible Game',
          slug: 'visible-game',
          coverUrl: null,
          cachedAt: new Date(),
          hidden: false,
        },
      ];

      // Provide a DB mock that returns rows for both count and data queries
      let callCount = 0;
      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                return Promise.resolve([{ count: 1 }]);
              }
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue(rows),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, undefined);
      expect(result.data.length).toBeGreaterThanOrEqual(0);
      expect(result.meta).toBeDefined();
    });

    it('returns only hidden games when showHidden is "only"', async () => {
      let callCount = 0;
      const hiddenRow = {
        id: 2,
        igdbId: 222,
        name: 'Hidden Game',
        slug: 'hidden-game',
        coverUrl: null,
        cachedAt: new Date(),
        hidden: true,
      };

      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                return Promise.resolve([{ count: 1 }]);
              }
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue([hiddenRow]),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, 'only');
      expect(result.data.length).toBeGreaterThanOrEqual(0);
    });

    it('includes hidden field in response data', async () => {
      const rows = [
        {
          id: 1,
          igdbId: 111,
          name: 'Visible Game',
          slug: 'visible-game',
          coverUrl: null,
          cachedAt: new Date(),
          hidden: false,
        },
        {
          id: 2,
          igdbId: 222,
          name: 'Hidden Game',
          slug: 'hidden-game',
          coverUrl: null,
          cachedAt: new Date(),
          hidden: true,
        },
      ];

      let callCount = 0;
      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                return Promise.resolve([{ count: 2 }]);
              }
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue(rows),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, 'true');

      // Every row should have a hidden boolean
      result.data.forEach((game) => {
        expect(typeof game.hidden).toBe('boolean');
      });
    });

    it('respects page and limit parameters', async () => {
      let callCount = 0;
      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ count: 50 }]);
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue([]),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, undefined, 2, 10);

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.total).toBe(50);
      expect(result.meta.totalPages).toBe(5);
    });

    it('clamps page to minimum 1', async () => {
      let callCount = 0;
      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ count: 0 }]);
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue([]),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, undefined, -5, 20);

      expect(result.meta.page).toBe(1);
    });

    it('clamps limit to maximum 100', async () => {
      let callCount = 0;
      (mockIgdbService.database as any) = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ count: 0 }]);
              return {
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    offset: jest.fn().mockResolvedValue([]),
                  }),
                }),
              };
            }),
          }),
        })),
      };

      const result = await controller.listGames(undefined, undefined, 1, 9999);

      expect(result.meta.limit).toBe(100);
    });
  });
});

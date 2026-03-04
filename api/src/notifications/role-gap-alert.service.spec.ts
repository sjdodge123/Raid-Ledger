import { Test, TestingModule } from '@nestjs/testing';
import { RoleGapAlertService } from './role-gap-alert.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('RoleGapAlertService', () => {
  let service: RoleGapAlertService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({
        id: 'notif-1',
        userId: 100,
        type: 'role_gap_alert',
        title: 'Role Gap Alert',
        message: 'Test',
        createdAt: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleGapAlertService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<RoleGapAlertService>(RoleGapAlertService);
  });

  /** Helper: mock select chain returning the given value. */
  function mockSelectChain(value: unknown[]) {
    return {
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockResolvedValue(value),
          }),
        }),
        where: jest.fn().mockResolvedValue(value),
      }),
    };
  }

  /** Helper: mock the insert dedup chain. */
  function mockDedupInsert(isNew: boolean) {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(
            isNew
              ? [
                  {
                    id: 1,
                    eventId: 10,
                    userId: 100,
                    reminderType: 'role_gap_4h',
                    sentAt: new Date(),
                  },
                ]
              : [],
          ),
        }),
      }),
    });
  }

  describe('checkRoleGaps', () => {
    const now = new Date();

    it('should send alert when MMO event is missing tanks', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Mythic Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 1 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 100,
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: expect.stringContaining('Missing 1 tank') as string,
          payload: expect.objectContaining({
            eventId: 10,
            eventTitle: 'Mythic Raid',
            gapSummary: 'Missing 1 tank',
            rosterSummary: 'Tanks: 1/2',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should send alert when missing healers', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 2 },
            { eventId: 10, role: 'healer', count: 2 },
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 healers',
            rosterSummary: 'Healers: 2/4',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should send alert when both tanks and healers are missing', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([{ eventId: 10, role: 'healer', count: 3 }]),
        )
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 tanks, 1 healer',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should NOT alert when roster is fully staffed', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 2 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        );

      await service.checkRoleGaps(now, 'UTC');

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should NOT alert when no MMO events are in the 4h window', async () => {
      mockDb.select.mockReturnValueOnce(mockSelectChain([]));

      await service.checkRoleGaps(now, 'UTC');

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip duplicate alerts (dedup returns empty)', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo', tank: 2, healer: 4 },
            },
          ]),
        )
        .mockReturnValueOnce(
          mockSelectChain([
            { eventId: 10, role: 'tank', count: 1 },
            { eventId: 10, role: 'healer', count: 4 },
          ]),
        );

      mockDedupInsert(false);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should use default slot counts when slotConfig omits them', async () => {
      const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      mockDb.select
        .mockReturnValueOnce(
          mockSelectChain([
            {
              id: 10,
              title: 'Raid',
              duration: [
                fourHoursOut,
                new Date(fourHoursOut.getTime() + 7200000),
              ] as [Date, Date],
              creatorId: 100,
              gameId: 1,
              slotConfig: { type: 'mmo' },
            },
          ]),
        )
        .mockReturnValueOnce(mockSelectChain([]))
        .mockReturnValueOnce(mockSelectChain([]));

      mockDedupInsert(true);

      await service.checkRoleGaps(now, 'UTC');

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gapSummary: 'Missing 2 tanks, 4 healers',
          }) as Record<string, unknown>,
        }),
      );
    });
  });

  describe('sendRoleGapAlert', () => {
    const now = new Date();
    const fourHoursOut = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    it('should return true on first send and false on duplicate', async () => {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 1,
                eventId: 10,
                userId: 100,
                reminderType: 'role_gap_4h',
                sentAt: now,
              },
            ]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result1 = await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [{ role: 'tank', required: 2, filled: 1, missing: 1 }],
        },
        'UTC',
      );

      expect(result1).toBe(true);
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);

      // Second call — duplicate
      mockNotificationService.create.mockClear();
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result2 = await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [{ role: 'tank', required: 2, filled: 1, missing: 1 }],
        },
        'UTC',
      );

      expect(result2).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should include suggested reason in payload', async () => {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 1,
                eventId: 10,
                userId: 100,
                reminderType: 'role_gap_4h',
                sentAt: now,
              },
            ]),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.sendRoleGapAlert(
        {
          eventId: 10,
          creatorId: 100,
          title: 'Raid',
          startTime: fourHoursOut,
          gameId: 1,
          gaps: [
            { role: 'tank', required: 2, filled: 0, missing: 2 },
            { role: 'healer', required: 4, filled: 3, missing: 1 },
          ],
        },
        'UTC',
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            suggestedReason:
              'Not enough tank/healer — missing 2 tanks, 1 healer',
          }) as Record<string, unknown>,
        }),
      );
    });
  });

  describe('detectRoleGaps', () => {
    it('should detect missing tanks', () => {
      const gaps = service.detectRoleGaps(
        { slotConfig: { type: 'mmo', tank: 2, healer: 4 } },
        new Map([['healer', 4]]),
      );
      expect(gaps).toEqual([
        { role: 'tank', required: 2, filled: 0, missing: 2 },
      ]);
    });

    it('should return empty when fully staffed', () => {
      const gaps = service.detectRoleGaps(
        { slotConfig: { type: 'mmo', tank: 2, healer: 4 } },
        new Map([
          ['tank', 2],
          ['healer', 4],
        ]),
      );
      expect(gaps).toEqual([]);
    });

    it('should use defaults when slotConfig omits counts', () => {
      const gaps = service.detectRoleGaps(
        { slotConfig: { type: 'mmo' } },
        undefined,
      );
      expect(gaps).toEqual([
        { role: 'tank', required: 2, filled: 0, missing: 2 },
        { role: 'healer', required: 4, filled: 0, missing: 4 },
      ]);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { GameTimeService } from './game-time.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

describe('GameTimeService', () => {
  let service: GameTimeService;
  let mockDb: MockDb;

  // Track which .where() call we're on to return different results
  let whereCallIndex: number;
  let whereResults: unknown[];

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    whereCallIndex = 0;
    whereResults = [];

    // By default, .where() resolves from whereResults array in order
    mockDb.where.mockImplementation(() => {
      const idx = whereCallIndex++;
      const result = whereResults[idx] ?? [];
      // Return chain mock with the resolved result
      return {
        ...mockDb,
        limit: jest.fn().mockResolvedValue(result),
        then: (resolve: (v: unknown) => void) => resolve(result),
        [Symbol.toStringTag]: 'Promise',
      };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameTimeService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<GameTimeService>(GameTimeService);
  });

  describe('getTemplate', () => {
    it('should return empty slots for new user', async () => {
      whereResults = [[]];

      const result = await service.getTemplate(1);

      expect(result.slots).toEqual([]);
    });

    it('should return mapped slots from database rows', async () => {
      whereResults = [
        [
          { dayOfWeek: 0, startHour: 18 },
          { dayOfWeek: 0, startHour: 19 },
          { dayOfWeek: 5, startHour: 20 },
        ],
      ];

      const result = await service.getTemplate(1);

      expect(result.slots).toEqual([
        { dayOfWeek: 0, hour: 18 },
        { dayOfWeek: 0, hour: 19 },
        { dayOfWeek: 5, hour: 20 },
      ]);
    });
  });

  describe('saveTemplate', () => {
    /**
     * Set up mocks for saveTemplate.
     * Call order for getCommittedTemplateKeys:
     *   1. Existing template slots query (.where)
     *   2. Event signups query (.where) — only if template has slots
     * Then the transaction runs (mocked separately).
     */
    function setupSaveTemplateMocks(
      existingTemplateSlots: Array<{
        dayOfWeek: number;
        startHour: number;
      }>,
      eventSignups: Array<{ duration: [Date, Date] }> = [],
    ) {
      whereCallIndex = 0;
      const results: unknown[] = [existingTemplateSlots];
      if (existingTemplateSlots.length > 0) {
        results.push(eventSignups);
      }
      whereResults = results;
    }

    it('should replace all slots via transaction when no committed slots exist', async () => {
      // No existing template slots → no committed keys to preserve
      setupSaveTemplateMocks([]);

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockTx.values.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      // Frontend sends 0=Sun convention; service converts to 0=Mon for DB
      const slots = [
        { dayOfWeek: 1, hour: 18 }, // Mon in 0=Sun convention → DB dayOfWeek=0
        { dayOfWeek: 2, hour: 20 }, // Tue in 0=Sun convention → DB dayOfWeek=1
      ];

      const result = await service.saveTemplate(1, slots);

      expect(mockTx.delete).toHaveBeenCalled();
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockTx.values).toHaveBeenCalled();
      expect(result.slots).toEqual(slots);
    });

    it('should handle empty slots (clear all) with no committed slots', async () => {
      setupSaveTemplateMocks([]);

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      const result = await service.saveTemplate(1, []);

      expect(mockTx.delete).toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(result.slots).toEqual([]);
    });

    it('should preserve committed slots that are not in the save payload', async () => {
      // Existing template: Mon 18:00 (DB dayOfWeek=0) and Mon 19:00
      // Event covers Mon 18:00-20:00 UTC → Mon 18 and 19 are committed
      const eventStart = new Date('2026-02-09T18:00:00.000Z'); // Mon 18:00 UTC
      const eventEnd = new Date('2026-02-09T20:00:00.000Z'); // Mon 20:00 UTC

      setupSaveTemplateMocks(
        [
          { dayOfWeek: 0, startHour: 18 }, // Mon 18:00
          { dayOfWeek: 0, startHour: 19 }, // Mon 19:00
        ],
        [{ duration: [eventStart, eventEnd] }],
      );

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockTx.values.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      // Frontend only sends Tue 20:00 (0=Sun convention: dayOfWeek=2)
      // Mon 18:00 and 19:00 are committed and should be auto-preserved
      const slots = [{ dayOfWeek: 2, hour: 20 }]; // Tue 20:00

      const result = await service.saveTemplate(1, slots);

      // Result should include the user's slot + preserved committed slots
      // Committed slots are in DB convention 0=Mon, returned in display convention 0=Sun
      // DB Mon (0) → display Mon (1)
      expect(result.slots).toEqual(
        expect.arrayContaining([
          { dayOfWeek: 2, hour: 20 }, // user-provided
          { dayOfWeek: 1, hour: 18 }, // preserved committed (DB 0 → display 1)
          { dayOfWeek: 1, hour: 19 }, // preserved committed (DB 0 → display 1)
        ]),
      );
      expect(result.slots).toHaveLength(3);

      // Verify transaction inserted all 3 slots
      expect(mockTx.values).toHaveBeenCalled();
      const valuesCall = mockTx.values.mock.calls[0] as unknown[];
      expect(valuesCall[0]).toHaveLength(3);
    });

    it('should not duplicate committed slots already in payload', async () => {
      // Existing template: Mon 18:00 (DB dayOfWeek=0)
      // Event covers Mon 18:00-19:00 UTC
      const eventStart = new Date('2026-02-09T18:00:00.000Z');
      const eventEnd = new Date('2026-02-09T19:00:00.000Z');

      setupSaveTemplateMocks(
        [{ dayOfWeek: 0, startHour: 18 }],
        [{ duration: [eventStart, eventEnd] }],
      );

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockTx.values.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      // Frontend sends Mon 18:00 (0=Sun: dayOfWeek=1) — already in the payload
      const slots = [{ dayOfWeek: 1, hour: 18 }];

      const result = await service.saveTemplate(1, slots);

      // Should not duplicate: only 1 slot
      expect(result.slots).toEqual([{ dayOfWeek: 1, hour: 18 }]);
      expect(result.slots).toHaveLength(1);
    });

    it('should handle clear-all when committed slots exist (preserve only committed)', async () => {
      // Existing template: Mon 18:00, Mon 19:00, Tue 20:00
      // Event covers Mon 18:00-19:00 UTC → Mon 18 is committed
      const eventStart = new Date('2026-02-09T18:00:00.000Z');
      const eventEnd = new Date('2026-02-09T19:00:00.000Z');

      setupSaveTemplateMocks(
        [
          { dayOfWeek: 0, startHour: 18 }, // committed
          { dayOfWeek: 0, startHour: 19 }, // not committed
          { dayOfWeek: 1, startHour: 20 }, // not committed
        ],
        [{ duration: [eventStart, eventEnd] }],
      );

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockTx.values.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      // Frontend sends empty slots (user cleared everything)
      const result = await service.saveTemplate(1, []);

      // Only the committed Mon 18:00 should be preserved
      expect(result.slots).toEqual([{ dayOfWeek: 1, hour: 18 }]); // DB 0 → display 1
      expect(result.slots).toHaveLength(1);
    });

    it('should return no preserved slots when no events overlap', async () => {
      // Existing template: Mon 18:00, but no events
      setupSaveTemplateMocks(
        [{ dayOfWeek: 0, startHour: 18 }],
        [], // no event signups
      );

      const mockTx = createDrizzleMock();
      mockTx.where.mockResolvedValue(undefined);
      mockTx.values.mockResolvedValue(undefined);
      mockDb.transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      // Frontend sends only Tue 20:00
      const slots = [{ dayOfWeek: 2, hour: 20 }];

      const result = await service.saveTemplate(1, slots);

      // No committed slots to preserve, just user's slots
      expect(result.slots).toEqual([{ dayOfWeek: 2, hour: 20 }]);
      expect(result.slots).toHaveLength(1);
    });
  });

  describe('getCompositeView', () => {
    const makeEventRow = (
      overrides: Partial<{
        eventId: number;
        title: string;
        description: string | null;
        duration: [Date, Date];
        signupId: number;
        confirmationStatus: string;
        gameSlug: string | null;
        gameName: string | null;
        gameCoverUrl: string | null;
        gameId: number | null;
        creatorId: number | null;
        creatorUsername: string | null;
      }> = {},
    ) => ({
      eventId: 1,
      title: 'Raid Night',
      description: null,
      duration: [
        new Date('2026-02-09T18:00:00.000Z'),
        new Date('2026-02-09T20:00:00.000Z'),
      ] as [Date, Date],
      signupId: 10,
      confirmationStatus: 'confirmed',
      gameSlug: null,
      gameName: null,
      gameCoverUrl: null,
      gameId: null,
      creatorId: null,
      creatorUsername: null,
      ...overrides,
    });

    /**
     * Set up mock DB responses for getCompositeView.
     * Call order:
     * 1. getTemplate query (via .where)
     * 2. signedUpEvents query (via .where)
     * 3. Batch allSignups query (via .where with inArray)
     * 4. Batch allCounts query (via .where with inArray + groupBy)
     * 5. Characters query (via .where with inArray) — only if signups exist
     * 6. Overrides query (.where with gte/lte)
     * 7. Absences query (.where with lte/gte)
     */
    function setupCompositeViewMocks(
      templateSlots: Array<{ dayOfWeek: number; startHour: number }>,
      events: ReturnType<typeof makeEventRow>[],
    ) {
      whereCallIndex = 0;
      const hasEvents = new Set(events.map((e) => e.eventId)).size > 0;
      const results: unknown[] = [templateSlots, events];

      if (hasEvents) {
        results.push([]); // batch allSignups (empty)
        results.push([]); // batch allCounts (empty)
      }

      // Overrides and absences (empty by default)
      results.push([]); // overrides
      results.push([]); // absences

      whereResults = results;
    }

    it('should return template slots as available when no events (remapped to 0=Sun)', async () => {
      // DB stores 0=Mon. Template has Mon 18:00 and Mon 19:00.
      setupCompositeViewMocks(
        [
          { dayOfWeek: 0, startHour: 18 },
          { dayOfWeek: 0, startHour: 19 },
        ],
        [],
      );

      // weekStart is Sunday Feb 8, 2026
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      // DB dayOfWeek 0 (Mon) → display dayOfWeek 1 (Mon in 0=Sun)
      expect(result.slots).toEqual([
        { dayOfWeek: 1, hour: 18, status: 'available', fromTemplate: true },
        { dayOfWeek: 1, hour: 19, status: 'available', fromTemplate: true },
      ]);
      expect(result.events).toEqual([]);
      expect(result.weekStart).toBe(weekStart.toISOString());
    });

    it('should mark overlapping slots as committed', async () => {
      // Template: DB Mon (dayOfWeek=0) 18:00
      // Event on Mon 18:00-20:00 UTC
      const eventStart = new Date('2026-02-09T18:00:00.000Z');
      const eventEnd = new Date('2026-02-09T20:00:00.000Z');

      setupCompositeViewMocks(
        [{ dayOfWeek: 0, startHour: 18 }],
        [makeEventRow({ duration: [eventStart, eventEnd] })],
      );

      // weekStart Sunday Feb 8
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      // Mon (display day 1) slot at 18:00 should be committed
      const monSlot = result.slots.find(
        (s) => s.dayOfWeek === 1 && s.hour === 18,
      );
      expect(monSlot?.status).toBe('committed');

      // Mon 19:00 should also appear as committed (off-template event hour)
      const offHourSlot = result.slots.find(
        (s) => s.dayOfWeek === 1 && s.hour === 19,
      );
      expect(offHourSlot?.status).toBe('committed');
    });

    it('should include committed slots for events outside the template', async () => {
      // No template slots
      // Event on Tue 10:00-12:00 UTC
      const eventStart = new Date('2026-02-10T10:00:00.000Z');
      const eventEnd = new Date('2026-02-10T12:00:00.000Z');

      setupCompositeViewMocks(
        [],
        [makeEventRow({ duration: [eventStart, eventEnd] })],
      );

      // weekStart Sunday Feb 8
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      // Tue = dayDiff 2 from Sunday (display day 2)
      expect(result.slots).toContainEqual({
        dayOfWeek: 2,
        hour: 10,
        status: 'committed',
        fromTemplate: false,
      });
      expect(result.slots).toContainEqual({
        dayOfWeek: 2,
        hour: 11,
        status: 'committed',
        fromTemplate: false,
      });
    });

    it('should return event blocks with correct day/hour spans', async () => {
      // Event on Wed 19:00-22:00 UTC
      setupCompositeViewMocks(
        [],
        [
          makeEventRow({
            eventId: 5,
            title: 'Mythic Raid',
            duration: [
              new Date('2026-02-11T19:00:00.000Z'),
              new Date('2026-02-11T22:00:00.000Z'),
            ],
            signupId: 20,
            confirmationStatus: 'pending',
          }),
        ],
      );

      // weekStart Sunday Feb 8
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        eventId: 5,
        title: 'Mythic Raid',
        signupId: 20,
        confirmationStatus: 'pending',
        dayOfWeek: 3, // Wed is dayDiff 3 from Sunday
        startHour: 19,
        endHour: 22,
        description: null,
        creatorUsername: null,
        signupsPreview: [],
        signupCount: 0,
      });
    });

    it('should split midnight-spanning events into two day entries', async () => {
      // Event Sun 22:00 - Mon 02:00 UTC
      setupCompositeViewMocks(
        [],
        [
          makeEventRow({
            eventId: 7,
            title: 'Late Raid',
            duration: [
              new Date('2026-02-08T22:00:00.000Z'),
              new Date('2026-02-09T02:00:00.000Z'),
            ],
          }),
        ],
      );

      // weekStart Sunday Feb 8
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      // Should create blocks on two different days
      expect(result.events).toHaveLength(2);
      const day0Block = result.events.find((e) => e.dayOfWeek === 0); // Sunday
      const day1Block = result.events.find((e) => e.dayOfWeek === 1); // Monday
      expect(day0Block).toMatchObject({ startHour: 22, endHour: 24 });
      expect(day1Block).toMatchObject({ startHour: 0, endHour: 2 });
    });

    it('should resolve game data from unified games table', async () => {
      setupCompositeViewMocks(
        [],
        [
          makeEventRow({
            gameSlug: 'world-of-warcraft',
            gameName: 'World of Warcraft',
            gameCoverUrl: '/cover.jpg',
            gameId: 1,
          }),
        ],
      );

      // weekStart Sunday Feb 8
      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      expect(result.events[0]).toMatchObject({
        gameSlug: 'world-of-warcraft',
        gameName: 'World of Warcraft',
        coverUrl: '/cover.jpg',
      });
    });

    it('should return enriched event data with creator and signups', async () => {
      const eventStart = new Date('2026-02-09T18:00:00.000Z');
      const eventEnd = new Date('2026-02-09T20:00:00.000Z');

      setupCompositeViewMocks(
        [],
        [
          makeEventRow({
            eventId: 10,
            title: 'Guild Run',
            description: 'Weekly guild dungeon run',
            duration: [eventStart, eventEnd],
            creatorId: 5,
            creatorUsername: 'GuildLeader',
          }),
        ],
      );

      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      expect(result.events[0]).toMatchObject({
        description: 'Weekly guild dungeon run',
        creatorUsername: 'GuildLeader',
        signupsPreview: [],
        signupCount: 0,
      });
    });

    it('should return overrides and absences in response', async () => {
      whereCallIndex = 0;
      whereResults = [
        [], // template
        [], // events
        // overrides
        [{ date: '2026-02-10', hour: 18, status: 'blocked' }],
        // absences
        [
          {
            id: 1,
            startDate: '2026-02-12',
            endDate: '2026-02-14',
            reason: 'Vacation',
          },
        ],
      ];

      const weekStart = new Date('2026-02-08T00:00:00.000Z');
      const result = await service.getCompositeView(1, weekStart);

      expect(result.overrides).toEqual([
        { date: '2026-02-10', hour: 18, status: 'blocked' },
      ]);
      expect(result.absences).toEqual([
        {
          id: 1,
          startDate: '2026-02-12',
          endDate: '2026-02-14',
          reason: 'Vacation',
        },
      ]);
    });
  });
});

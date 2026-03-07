import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EnrichmentsService } from './enrichments.service';
import { ENRICHMENT_QUEUE } from './enrichments.constants';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

function describeEnrichmentsService() {
  let service: EnrichmentsService;
  let mockDb: MockDb;
  let mockQueue: { add: jest.Mock };
  let mockPluginRegistry: { getMultiAdapters: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    mockPluginRegistry = { getMultiAdapters: jest.fn().mockReturnValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: getQueueToken(ENRICHMENT_QUEUE), useValue: mockQueue },
        { provide: PluginRegistryService, useValue: mockPluginRegistry },
      ],
    }).compile();

    service = module.get<EnrichmentsService>(EnrichmentsService);
  });

  function describeGetEnrichmentsForEntity() {
    it('should return mapped enrichment rows', async () => {
      const fetchedAt = new Date('2026-03-01T12:00:00Z');
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'aaa',
          entityType: 'character',
          entityId: 'char-1',
          enricherKey: 'raider-io',
          data: { score: 2500 },
          fetchedAt,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
        },
      ]);

      const result = await service.getEnrichmentsForEntity(
        'character',
        'char-1',
      );

      expect(result).toEqual([
        {
          enricherKey: 'raider-io',
          data: { score: 2500 },
          fetchedAt: '2026-03-01T12:00:00.000Z',
        },
      ]);
    });

    it('should return empty array when no enrichments exist', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.getEnrichmentsForEntity(
        'character',
        'char-none',
      );

      expect(result).toEqual([]);
    });
  }
  describe('getEnrichmentsForEntity()', () =>
    describeGetEnrichmentsForEntity());

  describe('upsertEnrichment()', () => {
    it('should call insert with onConflictDoUpdate', async () => {
      await service.upsertEnrichment('character', 'char-1', 'raider-io', {
        score: 2500,
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });
  });

  function describeEnqueueCharacterEnrichments() {
    async function testEnqueueJobsForEachEnricherWithEnrichCharacter() {
      const enricherA = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
      };
      const enricherB = {
        key: 'warcraftlogs',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([
        enricherA,
        enricherB,
      ]);

      const count = await service.enqueueCharacterEnrichments(
        'char-1',
        'world-of-warcraft',
      );

      expect(count).toBe(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'enrich-character:raider-io',
        {
          characterId: 'char-1',
          enricherKey: 'raider-io',
          gameSlug: 'world-of-warcraft',
        },
        expect.objectContaining({ attempts: 3 }),
      );
    }
    it('should enqueue jobs for each enricher with enrichCharacter', () =>
      testEnqueueJobsForEachEnricherWithEnrichCharacter());

    it('should skip enrichers without enrichCharacter method', async () => {
      const enricherNoChar = {
        key: 'event-only',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
        // no enrichCharacter
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricherNoChar]);

      const count = await service.enqueueCharacterEnrichments(
        'char-1',
        'world-of-warcraft',
      );

      expect(count).toBe(0);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should return 0 when no enrichers are registered', async () => {
      mockPluginRegistry.getMultiAdapters.mockReturnValue([]);

      const count = await service.enqueueCharacterEnrichments(
        'char-1',
        'world-of-warcraft',
      );

      expect(count).toBe(0);
    });
  }
  describe('enqueueCharacterEnrichments()', () =>
    describeEnqueueCharacterEnrichments());

  describe('enqueueEventEnrichments()', () => {
    it('should enqueue jobs for enrichers with enrichEvent', async () => {
      const enricher = {
        key: 'event-enricher',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      const count = await service.enqueueEventEnrichments(
        '42',
        'world-of-warcraft',
      );

      expect(count).toBe(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'enrich-event:event-enricher',
        {
          eventId: '42',
          enricherKey: 'event-enricher',
          gameSlug: 'world-of-warcraft',
        },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  function describeRunCharacterEnrichment() {
    it('should call enricher and upsert result', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn().mockResolvedValue({ mythicPlusScore: 2500 }),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      // Mock character lookup
      mockDb.limit.mockResolvedValueOnce([
        { id: 'char-1', name: 'TestChar', realm: 'Illidan' },
      ]);

      // Mock upsert (insert -> values -> onConflictDoUpdate)
      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      await service.runCharacterEnrichment(
        'char-1',
        'raider-io',
        'world-of-warcraft',
      );

      expect(enricher.enrichCharacter).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'char-1', name: 'TestChar' }),
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should skip when character not found', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      mockDb.limit.mockResolvedValueOnce([]);

      await service.runCharacterEnrichment(
        'char-missing',
        'raider-io',
        'world-of-warcraft',
      );

      expect(enricher.enrichCharacter).not.toHaveBeenCalled();
    });

    it('should skip when enricher not found for key', async () => {
      mockPluginRegistry.getMultiAdapters.mockReturnValue([]);

      await service.runCharacterEnrichment(
        'char-1',
        'nonexistent',
        'world-of-warcraft',
      );

      // Should not attempt DB lookup
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  }
  describe('runCharacterEnrichment()', () => describeRunCharacterEnrichment());

  function describeRunEventEnrichment() {
    it('should call enricher and upsert result', async () => {
      const enricher = {
        key: 'event-stats',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn().mockResolvedValue({ averageItemLevel: 625 }),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      // Mock event lookup (events.id is serial/number)
      mockDb.limit.mockResolvedValueOnce([{ id: 42, title: 'Raid Night' }]);

      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      await service.runEventEnrichment(
        '42',
        'event-stats',
        'world-of-warcraft',
      );

      expect(enricher.enrichEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, title: 'Raid Night' }),
      );
    });

    it('should skip when event not found', async () => {
      const enricher = {
        key: 'event-stats',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      mockDb.limit.mockResolvedValueOnce([]);

      await service.runEventEnrichment(
        '999',
        'event-stats',
        'world-of-warcraft',
      );

      expect(enricher.enrichEvent).not.toHaveBeenCalled();
    });

    it('should skip when enricher key found but has no enrichEvent method', async () => {
      // Enricher is registered but only has enrichCharacter — not enrichEvent
      const charOnlyEnricher = {
        key: 'char-only',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
        // no enrichEvent
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([charOnlyEnricher]);

      await service.runEventEnrichment('42', 'char-only', 'world-of-warcraft');

      // Should not attempt DB lookup for the event
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should propagate errors thrown by enrichEvent', async () => {
      const enricher = {
        key: 'failing-enricher',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn().mockRejectedValue(new Error('API down')),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      mockDb.limit.mockResolvedValueOnce([{ id: 42, title: 'Raid Night' }]);

      await expect(
        service.runEventEnrichment(
          '42',
          'failing-enricher',
          'world-of-warcraft',
        ),
      ).rejects.toThrow('API down');
    });
  }
  describe('runEventEnrichment()', () => describeRunEventEnrichment());

  function describeRunCharacterEnrichmentAdversarial() {
    it('should propagate errors thrown by enrichCharacter', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn().mockRejectedValue(new Error('Rate limited')),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      mockDb.limit.mockResolvedValueOnce([
        { id: 'char-1', name: 'TestChar', realm: 'Illidan' },
      ]);

      await expect(
        service.runCharacterEnrichment(
          'char-1',
          'raider-io',
          'world-of-warcraft',
        ),
      ).rejects.toThrow('Rate limited');
    });

    it('should skip when enricher key is found but has no enrichCharacter method', async () => {
      // Event-only enricher registered — lookup by key finds it but enrichCharacter is absent
      const eventOnlyEnricher = {
        key: 'event-only',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
        // no enrichCharacter
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([eventOnlyEnricher]);

      await service.runCharacterEnrichment(
        'char-1',
        'event-only',
        'world-of-warcraft',
      );

      // Should not attempt DB lookup for the character
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should use correct entity type "character" when upserting after enrichment', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn().mockResolvedValue({ score: 3000 }),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      mockDb.limit.mockResolvedValueOnce([
        { id: 'char-1', name: 'TestChar', realm: 'Illidan' },
      ]);
      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      await service.runCharacterEnrichment(
        'char-1',
        'raider-io',
        'world-of-warcraft',
      );

      // Verify insert was called (upsert path)
      expect(mockDb.insert).toHaveBeenCalled();
      // Verify values includes correct entityType and entityId
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'character',
          entityId: 'char-1',
          enricherKey: 'raider-io',
          data: { score: 3000 },
        }),
      );
    });
  }
  describe('runCharacterEnrichment() — adversarial', () =>
    describeRunCharacterEnrichmentAdversarial());

  function describeEnqueueEventEnrichmentsAdversarial() {
    it('should skip enrichers without enrichEvent method', async () => {
      const charOnlyEnricher = {
        key: 'char-only',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
        // no enrichEvent
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([charOnlyEnricher]);

      const count = await service.enqueueEventEnrichments(
        '42',
        'world-of-warcraft',
      );

      expect(count).toBe(0);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should return 0 when no enrichers are registered', async () => {
      mockPluginRegistry.getMultiAdapters.mockReturnValue([]);

      const count = await service.enqueueEventEnrichments(
        '42',
        'world-of-warcraft',
      );

      expect(count).toBe(0);
    });

    it('should enqueue jobs for multiple event enrichers', async () => {
      const enricherA = {
        key: 'warcraftlogs',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
      };
      const enricherB = {
        key: 'event-stats',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([
        enricherA,
        enricherB,
      ]);

      const count = await service.enqueueEventEnrichments(
        '42',
        'world-of-warcraft',
      );

      expect(count).toBe(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  }
  describe('enqueueEventEnrichments() — adversarial', () =>
    describeEnqueueEventEnrichmentsAdversarial());

  function describeGetEnrichmentsForEntityAdversarial() {
    async function testMapMultipleEnrichmentRowsIndependently() {
      const ts1 = new Date('2026-01-01T00:00:00Z');
      const ts2 = new Date('2026-02-15T12:30:00Z');

      mockDb.where.mockResolvedValueOnce([
        {
          id: 'row-1',
          entityType: 'character',
          entityId: 'char-1',
          enricherKey: 'raider-io',
          data: { score: 2500 },
          fetchedAt: ts1,
          createdAt: ts1,
          updatedAt: ts1,
        },
        {
          id: 'row-2',
          entityType: 'character',
          entityId: 'char-1',
          enricherKey: 'warcraftlogs',
          data: { highestParse: 95 },
          fetchedAt: ts2,
          createdAt: ts2,
          updatedAt: ts2,
        },
      ]);

      const result = await service.getEnrichmentsForEntity(
        'character',
        'char-1',
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        enricherKey: 'raider-io',
        data: { score: 2500 },
        fetchedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result[1]).toMatchObject({
        enricherKey: 'warcraftlogs',
        data: { highestParse: 95 },
        fetchedAt: '2026-02-15T12:30:00.000Z',
      });
    }
    it('should map multiple enrichment rows independently', () =>
      testMapMultipleEnrichmentRowsIndependently());

    it('should not include internal DB fields (id, createdAt, updatedAt) in returned shape', async () => {
      const fetchedAt = new Date('2026-03-01T00:00:00Z');
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'internal-uuid',
          entityType: 'event',
          entityId: 'event-99',
          enricherKey: 'event-stats',
          data: { avgIlvl: 620 },
          fetchedAt,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
        },
      ]);

      const result = await service.getEnrichmentsForEntity('event', 'event-99');

      expect(result[0]).not.toHaveProperty('id');
      expect(result[0]).not.toHaveProperty('createdAt');
      expect(result[0]).not.toHaveProperty('updatedAt');
      expect(result[0]).not.toHaveProperty('entityType');
      expect(result[0]).not.toHaveProperty('entityId');
      expect(Object.keys(result[0])).toEqual([
        'enricherKey',
        'data',
        'fetchedAt',
      ]);
    });
  }
  describe('getEnrichmentsForEntity() — adversarial', () =>
    describeGetEnrichmentsForEntityAdversarial());

  function describeUpsertEnrichmentAdversarial() {
    it('should insert with correct entity fields and timestamps', async () => {
      const beforeCall = Date.now();
      await service.upsertEnrichment('event', 'event-42', 'warcraftlogs', {
        avgParse: 88,
      });
      const afterCall = Date.now();

      expect(mockDb.insert).toHaveBeenCalled();
      const valuesCall = mockDb.values.mock.calls[0][0] as Record<
        string,
        unknown
      >;

      expect(valuesCall.entityType).toBe('event');
      expect(valuesCall.entityId).toBe('event-42');
      expect(valuesCall.enricherKey).toBe('warcraftlogs');
      expect(valuesCall.data).toEqual({ avgParse: 88 });

      // Timestamps should be fresh Dates, not strings
      expect(valuesCall.fetchedAt).toBeInstanceOf(Date);
      expect(valuesCall.createdAt).toBeInstanceOf(Date);
      expect(valuesCall.updatedAt).toBeInstanceOf(Date);

      const ts = (valuesCall.fetchedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(beforeCall);
      expect(ts).toBeLessThanOrEqual(afterCall);
    });

    it('should trigger onConflictDoUpdate (upsert path) — not onConflictDoNothing', async () => {
      await service.upsertEnrichment('character', 'char-1', 'raider-io', {
        score: 1000,
      });

      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
      expect(mockDb.onConflictDoNothing).not.toHaveBeenCalled();
    });

    it('should update data and fetchedAt but preserve enricher identity in conflict target', async () => {
      await service.upsertEnrichment('character', 'char-1', 'raider-io', {
        newScore: 3500,
      });

      const conflictCall = mockDb.onConflictDoUpdate.mock.calls[0][0] as {
        target: unknown[];
        set: Record<string, unknown>;
      };

      // Conflict target must include entityType, entityId, and enricherKey
      expect(conflictCall.target).toHaveLength(3);

      // Set clause must update data and fetchedAt but NOT enricherKey or entityType
      expect(conflictCall.set).toHaveProperty('data', { newScore: 3500 });
      expect(conflictCall.set).toHaveProperty('fetchedAt');
      expect(conflictCall.set).not.toHaveProperty('enricherKey');
      expect(conflictCall.set).not.toHaveProperty('entityType');
      expect(conflictCall.set).not.toHaveProperty('entityId');
    });
  }
  describe('upsertEnrichment() — adversarial', () =>
    describeUpsertEnrichmentAdversarial());

  function describeEnqueueCharacterEnrichmentsAdversarial() {
    it('should enqueue with correct BullMQ retry options', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      await service.enqueueCharacterEnrichments('char-1', 'world-of-warcraft');

      const jobOptions = mockQueue.add.mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect(jobOptions.attempts).toBe(3);
      expect(jobOptions.backoff).toMatchObject({
        type: 'exponential',
        delay: 5000,
      });
      expect(typeof jobOptions.removeOnComplete).not.toBe('undefined');
      expect(typeof jobOptions.removeOnFail).not.toBe('undefined');
    });

    it('should enqueue all mixed enrichers (some with, some without enrichCharacter)', async () => {
      const charEnricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest.fn(),
      };
      const eventOnlyEnricher = {
        key: 'event-only',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest.fn(),
        // no enrichCharacter
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([
        charEnricher,
        eventOnlyEnricher,
      ]);

      const count = await service.enqueueCharacterEnrichments(
        'char-1',
        'world-of-warcraft',
      );

      // Only the enricher with enrichCharacter should be enqueued
      expect(count).toBe(1);
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'enrich-character:raider-io',
        expect.objectContaining({ enricherKey: 'raider-io' }),
        expect.any(Object),
      );
    });
  }
  describe('enqueueCharacterEnrichments() — adversarial', () =>
    describeEnqueueCharacterEnrichmentsAdversarial());
}
describe('EnrichmentsService', () => describeEnrichmentsService());

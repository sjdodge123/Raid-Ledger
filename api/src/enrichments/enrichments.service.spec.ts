import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EnrichmentsService } from './enrichments.service';
import { ENRICHMENT_QUEUE } from './enrichments.constants';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

describe('EnrichmentsService', () => {
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

  describe('getEnrichmentsForEntity()', () => {
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
  });

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

  describe('enqueueCharacterEnrichments()', () => {
    it('should enqueue jobs for each enricher with enrichCharacter', async () => {
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
    });

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
  });

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

  describe('runCharacterEnrichment()', () => {
    it('should call enricher and upsert result', async () => {
      const enricher = {
        key: 'raider-io',
        gameSlugs: ['world-of-warcraft'],
        enrichCharacter: jest
          .fn()
          .mockResolvedValue({ mythicPlusScore: 2500 }),
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
  });

  describe('runEventEnrichment()', () => {
    it('should call enricher and upsert result', async () => {
      const enricher = {
        key: 'event-stats',
        gameSlugs: ['world-of-warcraft'],
        enrichEvent: jest
          .fn()
          .mockResolvedValue({ averageItemLevel: 625 }),
      };
      mockPluginRegistry.getMultiAdapters.mockReturnValue([enricher]);

      // Mock event lookup (events.id is serial/number)
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, title: 'Raid Night' },
      ]);

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
  });
});

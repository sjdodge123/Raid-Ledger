import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { DataEnricher } from '../plugins/plugin-host/extension-points';
import {
  ENRICHMENT_QUEUE,
  EnrichCharacterJobData,
  EnrichEventJobData,
} from './enrichments.constants';

@Injectable()
export class EnrichmentsService {
  private readonly logger = new Logger(EnrichmentsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly pluginRegistry: PluginRegistryService,
    @InjectQueue(ENRICHMENT_QUEUE) private readonly enrichmentQueue: Queue,
  ) {}

  /**
   * Get all enrichments for a given entity.
   */
  async getEnrichmentsForEntity(
    entityType: string,
    entityId: string,
  ): Promise<{ enricherKey: string; data: unknown; fetchedAt: string }[]> {
    const rows = await this.db
      .select()
      .from(schema.enrichments)
      .where(
        and(
          eq(schema.enrichments.entityType, entityType),
          eq(schema.enrichments.entityId, entityId),
        ),
      );

    return rows.map((row) => ({
      enricherKey: row.enricherKey,
      data: row.data,
      fetchedAt: row.fetchedAt.toISOString(),
    }));
  }

  /**
   * Upsert an enrichment row (ON CONFLICT safe for retries).
   */
  async upsertEnrichment(
    entityType: string,
    entityId: string,
    enricherKey: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.enrichments)
      .values({
        entityType,
        entityId,
        enricherKey,
        data,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.enrichments.entityType,
          schema.enrichments.entityId,
          schema.enrichments.enricherKey,
        ],
        set: {
          data,
          fetchedAt: now,
          updatedAt: now,
        },
      });
  }

  /**
   * Enqueue enrichment jobs for a character.
   * Finds all DataEnrichers registered for the character's game slug.
   */
  async enqueueCharacterEnrichments(
    characterId: string,
    gameSlug: string,
  ): Promise<number> {
    const enrichers = this.pluginRegistry.getMultiAdapters<DataEnricher>(
      EXTENSION_POINTS.DATA_ENRICHER,
      gameSlug,
    );

    let enqueued = 0;
    for (const enricher of enrichers) {
      if (!enricher.enrichCharacter) continue;

      const jobData: EnrichCharacterJobData = {
        characterId,
        enricherKey: enricher.key,
        gameSlug,
      };

      await this.enrichmentQueue.add(
        `enrich-character:${enricher.key}`,
        jobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      enqueued++;
    }

    if (enqueued > 0) {
      this.logger.debug(
        `Enqueued ${enqueued} enrichment job(s) for character ${characterId} (game: ${gameSlug})`,
      );
    }

    return enqueued;
  }

  /**
   * Enqueue enrichment jobs for an event.
   */
  async enqueueEventEnrichments(
    eventId: string,
    gameSlug: string,
  ): Promise<number> {
    const enrichers = this.pluginRegistry.getMultiAdapters<DataEnricher>(
      EXTENSION_POINTS.DATA_ENRICHER,
      gameSlug,
    );

    let enqueued = 0;
    for (const enricher of enrichers) {
      if (!enricher.enrichEvent) continue;

      const jobData: EnrichEventJobData = {
        eventId,
        enricherKey: enricher.key,
        gameSlug,
      };

      await this.enrichmentQueue.add(`enrich-event:${enricher.key}`, jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      enqueued++;
    }

    if (enqueued > 0) {
      this.logger.debug(
        `Enqueued ${enqueued} enrichment job(s) for event ${eventId} (game: ${gameSlug})`,
      );
    }

    return enqueued;
  }

  /**
   * Execute a single enricher for a character (called by the processor).
   */
  async runCharacterEnrichment(
    characterId: string,
    enricherKey: string,
    gameSlug: string,
  ): Promise<void> {
    const enrichers = this.pluginRegistry.getMultiAdapters<DataEnricher>(
      EXTENSION_POINTS.DATA_ENRICHER,
      gameSlug,
    );

    const enricher = enrichers.find((e) => e.key === enricherKey);
    if (!enricher?.enrichCharacter) {
      this.logger.warn(
        `Enricher "${enricherKey}" not found or has no enrichCharacter method`,
      );
      return;
    }

    // Fetch the character row as a plain record
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);

    if (!character) {
      this.logger.warn(
        `Character ${characterId} not found — skipping enrichment`,
      );
      return;
    }

    const data = await enricher.enrichCharacter(
      character as unknown as Record<string, unknown>,
    );
    await this.upsertEnrichment('character', characterId, enricherKey, data);

    this.logger.debug(
      `Enrichment "${enricherKey}" completed for character ${characterId}`,
    );
  }

  /**
   * Execute a single enricher for an event (called by the processor).
   */
  async runEventEnrichment(
    eventId: string,
    enricherKey: string,
    gameSlug: string,
  ): Promise<void> {
    const enrichers = this.pluginRegistry.getMultiAdapters<DataEnricher>(
      EXTENSION_POINTS.DATA_ENRICHER,
      gameSlug,
    );

    const enricher = enrichers.find((e) => e.key === enricherKey);
    if (!enricher?.enrichEvent) {
      this.logger.warn(
        `Enricher "${enricherKey}" not found or has no enrichEvent method`,
      );
      return;
    }

    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, Number(eventId)))
      .limit(1);

    if (!event) {
      this.logger.warn(`Event ${eventId} not found — skipping enrichment`);
      return;
    }

    const data = await enricher.enrichEvent(
      event as unknown as Record<string, unknown>,
    );
    await this.upsertEnrichment('event', eventId, enricherKey, data);

    this.logger.debug(
      `Enrichment "${enricherKey}" completed for event ${eventId}`,
    );
  }
}

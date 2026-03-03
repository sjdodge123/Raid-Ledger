import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Enrichments — cached third-party data layered onto characters/events.
 * Written by DataEnricher plugins via background jobs (ROK-269).
 */
export const enrichments = pgTable(
  'enrichments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The entity type this enrichment belongs to */
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    /** ID of the character (UUID) or event (serial as string) */
    entityId: varchar('entity_id', { length: 100 }).notNull(),
    /** Enricher key, e.g. 'raider-io', 'warcraftlogs' */
    enricherKey: varchar('enricher_key', { length: 100 }).notNull(),
    /** Enricher-specific data payload */
    data: jsonb('data').notNull(),
    /** When the enricher last fetched this data */
    fetchedAt: timestamp('fetched_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    /** Each enricher stores one row per entity */
    uniqueEnrichment: unique('unique_entity_enricher').on(
      table.entityType,
      table.entityId,
      table.enricherKey,
    ),
    /** Fast lookups by entity */
    entityLookup: index('idx_enrichments_entity').on(
      table.entityType,
      table.entityId,
    ),
  }),
);

export type EnrichmentInsert = typeof enrichments.$inferInsert;
export type EnrichmentSelect = typeof enrichments.$inferSelect;

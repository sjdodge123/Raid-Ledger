import { z } from 'zod';
import { RlGameIdSchema } from './hub-envelope.schema.js';

/**
 * ROK-1667 (RH-1a) — relay hub v1 crosswalk: game id mappings an instance
 * contributes to the hub (`POST /api/v1/crosswalk/contributions`).
 *
 * Contributions are writer-side and hub-validated, so they are `.strict()`:
 * a `summary`, `coverUrl` or any other non-id key is a 400, not silently
 * stripped ("id mappings only"). Each item needs at least one strong id
 * (D7: name-only games are rejected) and exactly one provenance entry per
 * id sent (D15). The contributed `name` is identity only: stored
 * match-only, never served as a title (D6).
 *
 * M2 adds `CrosswalkEntrySchema` and `HubPageSchema<T>`; not here.
 */

export const CrosswalkKindSchema = z.enum([
  'igdb_id',
  'igdb_slug',
  'steam_app_id',
  'itad_uuid',
  'itad_slug',
  'wikidata_qid',
  'normalized_name',
]);

export type CrosswalkKind = z.infer<typeof CrosswalkKindSchema>;

/**
 * D15: where the instance got the id. An unrecognised value degrades to
 * `'unknown'` (match-only on the hub), never a 400.
 */
export const CrosswalkIdProvenanceSchema = z
  .enum(['steam', 'igdb', 'itad', 'wikidata', 'manual', 'unknown'])
  .catch('unknown');

export type CrosswalkIdProvenance = z.infer<typeof CrosswalkIdProvenanceSchema>;

const CROSSWALK_ID_KEYS = ['igdbId', 'steamAppId', 'itadUuid'] as const;

export const CrosswalkContributionItemSchema = z
  .object({
    /** The instance's local games.id; never stored. */
    clientRef: z.string().max(40),
    /** Identity only (addendum §6.4, "instance-contributed game identities"). */
    name: z.string().min(1).max(200),
    igdbId: z.number().int().positive().optional(),
    steamAppId: z.number().int().positive().optional(),
    itadUuid: z.uuid().optional(),
    /** D15: exactly one entry per id sent. */
    provenance: z
      .object({
        igdbId: CrosswalkIdProvenanceSchema.optional(),
        steamAppId: CrosswalkIdProvenanceSchema.optional(),
        itadUuid: CrosswalkIdProvenanceSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .refine((i) => i.igdbId ?? i.steamAppId ?? i.itadUuid, 'at least one strong id')
  .refine(
    (i) =>
      CROSSWALK_ID_KEYS.every(
        (k) => (i[k] === undefined) === (i.provenance[k] === undefined),
      ),
    'one provenance per id sent, and none without its id',
  );

export type CrosswalkContributionItem = z.infer<
  typeof CrosswalkContributionItemSchema
>;

/** Body of `POST /api/v1/crosswalk/contributions`: at most 100 items. */
export const CrosswalkContributionBatchSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(1),
    items: z.array(CrosswalkContributionItemSchema).min(1).max(100),
  })
  .strict();

export type CrosswalkContributionBatch = z.infer<
  typeof CrosswalkContributionBatchSchema
>;

export const CrosswalkContributionResultSchema = z.object({
  clientRef: z.string(),
  result: z
    .enum(['created', 'matched', 'attached', 'conflict', 'rejected', 'unknown'])
    .catch('unknown'),
  rlGameId: RlGameIdSchema.optional(),
});

export type CrosswalkContributionResult = z.infer<
  typeof CrosswalkContributionResultSchema
>;

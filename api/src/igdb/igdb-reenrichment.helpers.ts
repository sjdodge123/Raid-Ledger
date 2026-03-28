/**
 * IGDB re-enrichment helpers (ROK-986).
 *
 * TDD STUB: This file exports the function signature only.
 * The dev agent will implement the full logic to make tests pass.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { IgdbApiGame } from './igdb.constants';

export interface ReEnrichResult {
  attempted: number;
  enriched: number;
  failed: number;
  exhausted: number;
}

/**
 * Re-enrich games that have a Steam App ID but are missing IGDB metadata.
 * Queries candidates with status IN ('pending', 'failed'), non-null steamAppId,
 * and retry count < 3. Processes in batches of 3 with 500ms delay.
 *
 * @param db - Database connection
 * @param queryIgdb - Function to execute IGDB queries
 * @returns Enrichment result counts
 */
export async function reEnrichGamesWithIgdb(
  _db: PostgresJsDatabase<typeof schema>,
  _queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
): Promise<ReEnrichResult> {
  // TDD stub — not yet implemented
  throw new Error('reEnrichGamesWithIgdb is not implemented');
}

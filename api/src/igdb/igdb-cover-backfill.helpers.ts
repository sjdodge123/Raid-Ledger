import { Logger } from '@nestjs/common';
import type { IgdbApiGame } from './igdb.constants';

const logger = new Logger('IgdbCoverBackfill');

/** IGDB rejects (HTTP 400) an id list or `limit` above 500 per query. */
const IGDB_ID_QUERY_CHUNK = 500;

/**
 * Query IGDB for cover image ids in chunks of ≤500 ids. One rejected chunk is
 * logged and skipped so the other chunks (and the rest of the sync) still run;
 * prod once had enough missing-cover rows for a single query to trip the cap
 * and abort the whole sync job, leaving new rows with no cover.
 */
export async function fetchCoversInChunks(
  ids: number[],
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
): Promise<IgdbApiGame[]> {
  const results: IgdbApiGame[] = [];
  let chunks = 0;
  let failed = 0;
  let lastError: unknown;
  for (let i = 0; i < ids.length; i += IGDB_ID_QUERY_CHUNK) {
    const chunk = ids.slice(i, i + IGDB_ID_QUERY_CHUNK);
    chunks++;
    try {
      results.push(
        ...(await queryIgdb(
          `fields id, cover.image_id; where id = (${chunk.join(',')}); limit ${chunk.length};`,
        )),
      );
    } catch (err) {
      failed++;
      lastError = err;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `IGDB sync: cover backfill chunk of ${chunk.length} ids failed, skipping: ${reason}`,
      );
    }
  }
  // Every chunk rejected = IGDB itself is down/refusing, not one bad batch —
  // surface it instead of reporting "nothing to backfill".
  if (failed > 0 && failed === chunks) throw lastError;
  return results;
}

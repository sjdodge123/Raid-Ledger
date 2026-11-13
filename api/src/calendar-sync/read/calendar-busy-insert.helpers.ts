/**
 * Chunked insert of a connection's busy blocks. One multi-row INSERT binds
 * one parameter per column per row, and Postgres caps a statement at 65,535
 * bind parameters — a large calendar in one `values(rows)` call fails the
 * whole read sync. Chunks run sequentially on the caller's transaction.
 */
import * as schema from '../../drizzle/schema';
import type { NormalizedBusyBlock } from './calendar-read-normalize.helpers';

/** Rows per INSERT — ~7 columns each keeps a chunk far below 65,535 params. */
export const BUSY_BLOCK_INSERT_CHUNK = 1_000;

type BusyBlockInsert = typeof schema.calendarBusyBlocks.$inferInsert;

/** The slice of a drizzle transaction this helper needs. */
export interface BusyBlockInserter {
  insert(table: typeof schema.calendarBusyBlocks): {
    values(rows: BusyBlockInsert[]): PromiseLike<unknown>;
  };
}

/** Split `rows` into consecutive chunks of at most `size` items. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** Insert every block with its owner, at most `chunkSize` rows per INSERT. */
export async function insertBusyBlocks(
  tx: BusyBlockInserter,
  rows: readonly NormalizedBusyBlock[],
  owner: { connectionId: number; userId: number },
  chunkSize: number = BUSY_BLOCK_INSERT_CHUNK,
): Promise<void> {
  const table = schema.calendarBusyBlocks;
  for (const chunk of chunkRows(rows, chunkSize)) {
    await tx.insert(table).values(chunk.map((r) => ({ ...r, ...owner })));
  }
}

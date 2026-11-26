import { readFileSync } from 'fs';
import * as path from 'path';
import type { Sql } from 'postgres';
import { z } from 'zod';

const JournalSchema = z.object({
  entries: z.array(z.object({ when: z.number(), tag: z.string() })),
});

export type JournalEntry = z.infer<typeof JournalSchema>['entries'][number];

/** L4: what `run-migrations --status` prints (RH-5b names dumps from it). */
export interface MigrationStatus {
  readonly applied: string | null;
  readonly head: string | null;
  readonly pending: number;
}

export function readJournal(folder: string): JournalEntry[] {
  const file = path.join(folder, 'meta', '_journal.json');
  return JournalSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).entries;
}

/**
 * Pending = journal entries newer than the newest applied `created_at`, which
 * is exactly what Drizzle's migrator applies next.
 */
export function computeStatus(
  entries: readonly JournalEntry[],
  lastAppliedAt: number | null,
): MigrationStatus {
  const head = entries.at(-1)?.tag ?? null;
  const done =
    lastAppliedAt === null
      ? []
      : entries.filter((e) => e.when <= lastAppliedAt);
  return {
    applied: done.at(-1)?.tag ?? null,
    head,
    pending: entries.length - done.length,
  };
}

/** Newest `drizzle.__drizzle_migrations.created_at`, or null when none. */
export async function lastAppliedAt(sql: Sql): Promise<number | null> {
  const [exists] = await sql<{ t: string | null }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t`;
  if (!exists?.t) return null;
  const [row] = await sql<{ created_at: string | null }[]>`
    SELECT max(created_at)::text AS created_at FROM drizzle.__drizzle_migrations`;
  return row?.created_at ? Number(row.created_at) : null;
}

export async function readStatus(
  sql: Sql,
  folder: string,
): Promise<MigrationStatus> {
  return computeStatus(readJournal(folder), await lastAppliedAt(sql));
}

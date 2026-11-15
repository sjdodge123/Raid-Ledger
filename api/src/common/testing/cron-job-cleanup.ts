import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * `truncateAllTables` keeps `cron_jobs` (the app's registered jobs live there),
 * so an integration spec that inserts its own rows must delete them by name —
 * else a reused DB or template clone fails the next run on
 * `cron_jobs_name_unique`. Executions cascade with their job.
 */
export async function deleteCronJobsByName(
  db: Db,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) return;
  await db
    .delete(schema.cronJobs)
    .where(inArray(schema.cronJobs.name, [...names]));
}

/** Per-spec tracker of the cron_jobs names a spec inserts. */
export interface CronJobNameTracker {
  /** Delete-before-insert (cleans a pre-dirty DB) and remember the name. */
  claim(db: Db, name: string): Promise<void>;
  /** afterEach: delete every claimed row, then forget the names. */
  cleanup(db: Db): Promise<void>;
}

/** Create a tracker; call `claim` in the spec's insert helper. */
export function createCronJobNameTracker(): CronJobNameTracker {
  const names = new Set<string>();
  return {
    async claim(db, name) {
      await deleteCronJobsByName(db, [name]);
      names.add(name);
    },
    async cleanup(db) {
      await deleteCronJobsByName(db, [...names]);
      names.clear();
    },
  };
}

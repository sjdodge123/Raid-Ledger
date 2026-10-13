import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { plugins } from '../../drizzle/schema';
import { PELICAN_PLUGIN_ID } from './pelican.constants';

export type PelicanDb = PostgresJsDatabase<typeof schema>;
export type PelicanTx = Parameters<Parameters<PelicanDb['transaction']>[0]>[0];
export type PelicanExecutor = PelicanDb | PelicanTx;

/**
 * `SELECT … FOR SHARE` on the active Pelican `plugins` row (ROK-1772 D13,
 * shared with ROK-1773). `false` = the plugin is inactive: the caller writes
 * nothing. Holding the share lock makes a concurrent deactivate (which must
 * precede uninstall) wait for the caller's commit, so uninstall's cascade
 * always runs after the write and cannot leave rows behind.
 */
export async function lockActivePlugin(tx: PelicanExecutor): Promise<boolean> {
  const rows = await tx.execute(
    sql`select 1 from ${plugins} where ${plugins.slug} = ${PELICAN_PLUGIN_ID} and ${plugins.active} = true for share`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

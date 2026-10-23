/**
 * ROK-1930 L5 — the Deaths fixture's OWN Valheim Pelican server + its visible
 * hub, one per worker slot (stable panel UUID → the same row every call).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { ensureArmoryCatalog } from './valheim-armory-demo-seed.helpers';
import { ensureFixtureHubId } from './valheim-armory-map-hub.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The worker's server (and hub) name. */
export function deathsServerName(worker: number): string {
  return `Deathheim ${worker}`;
}

/** The worker's fixture server's (stable) Pelican panel UUID. */
export function deathsPanelUuid(worker: number): string {
  return `00000000-0000-4000-8000-0000001930${pad2(worker)}`;
}

async function upsertDeathsServer(
  db: Db,
  worker: number,
  gameId: number,
): Promise<number> {
  const S = schema.pelicanServers;
  const name = deathsServerName(worker);
  const [row] = await db
    .insert(S)
    .values({
      panelUuid: deathsPanelUuid(worker),
      identifier: `dthfix${worker}v`,
      name,
      gameId,
      presenceTracking: false,
      showOnCalendar: false,
    })
    .onConflictDoUpdate({ target: S.panelUuid, set: { name, gameId } })
    .returning({ id: S.id });
  if (!row) throw new Error('deaths fixture: server upsert returned no row');
  return row.id;
}

/** The worker's server + its visible hub (catalogue inserted when absent). */
export async function ensureDeathsHub(
  db: Db,
  worker: number,
  gameId: number,
): Promise<{ serverId: number; guildId: number }> {
  const serverId = await upsertDeathsServer(db, worker, gameId);
  await ensureArmoryCatalog(db, serverId);
  const guildId = await ensureFixtureHubId(db, serverId, gameId);
  return { serverId, guildId };
}

import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  games,
  pelicanServers,
  type NewPelicanServer,
} from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** `.invalid` never resolves (RFC 2606), so a seeded env never reaches a panel. */
export const DEMO_PELICAN_PANEL_URL = 'http://pelican.invalid';
/** Obviously fake client key — a fixture, never a real credential. */
export const DEMO_PELICAN_API_KEY = 'pacc_DEMOfakeKeyNotARealPelicanKey';

/** The four admin-table states the ROK-1094 fleet test plan walks through. */
export type PelicanSeedKind =
  'running_mapped' | 'offline_unmapped' | 'unknown_hidden' | 'missing';

export interface PelicanSeedServer {
  kind: PelicanSeedKind;
  id: number;
  name: string;
}

export interface PelicanSeedResult {
  gameId: number;
  gameName: string;
  servers: PelicanSeedServer[];
}

interface SeedSpec {
  kind: PelicanSeedKind;
  values: NewPelicanServer;
}

function demoUuid(n: number): string {
  return `de300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function baseRow(n: number, name: string, now: Date): NewPelicanServer {
  return {
    panelUuid: demoUuid(n),
    identifier: `de30000${n}`,
    name,
    lastSyncedAt: now,
  };
}

/** Row values per state: mapped rows point at `gameId`. */
export function buildDemoServers(gameId: number, now: Date): SeedSpec[] {
  const states: [PelicanSeedKind, string, Partial<NewPelicanServer>][] = [
    [
      'running_mapped',
      'Running',
      { gameId, currentState: 'running', statusCheckedAt: now },
    ],
    [
      'offline_unmapped',
      'Offline',
      { currentState: 'offline', statusCheckedAt: now },
    ],
    ['unknown_hidden', 'Hidden', { gameId, showOnCalendar: false }],
    ['missing', 'Missing', { missingSince: now }],
  ];
  return states.map(([kind, label, extra], i) => ({
    kind,
    values: { ...baseRow(i + 1, `Demo Server — ${label}`, now), ...extra },
  }));
}

/** A stable game to map: the first visible, non-banned game by name. */
async function pickDemoGame(
  db: Db,
): Promise<{ id: number; name: string } | null> {
  const [game] = await db
    .select({ id: games.id, name: games.name })
    .from(games)
    .where(and(eq(games.hidden, false), eq(games.banned, false)))
    .orderBy(asc(games.name), asc(games.id))
    .limit(1);
  return game ?? null;
}

/**
 * Wipe `pelican_servers` and insert the four demo rows (re-run = reset).
 * Returns `null` when there is no game to map.
 */
export async function seedDemoPelicanServers(
  db: Db,
  now: Date,
): Promise<PelicanSeedResult | null> {
  const game = await pickDemoGame(db);
  if (!game) return null;
  const specs = buildDemoServers(game.id, now);
  const inserted = await db.transaction(async (tx) => {
    await tx.delete(pelicanServers);
    return tx
      .insert(pelicanServers)
      .values(specs.map((s) => s.values))
      .returning({
        id: pelicanServers.id,
        name: pelicanServers.name,
        panelUuid: pelicanServers.panelUuid,
      });
  });
  const servers = specs.flatMap((spec) => {
    const row = inserted.find((r) => r.panelUuid === spec.values.panelUuid);
    return row ? [{ kind: spec.kind, id: row.id, name: row.name }] : [];
  });
  return { gameId: game.id, gameName: game.name, servers };
}

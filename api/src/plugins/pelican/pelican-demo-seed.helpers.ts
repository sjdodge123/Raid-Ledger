import { and, asc, eq, notInArray } from 'drizzle-orm';
import { QUICK_PLAY_FIXTURE_UUIDS } from './pelican-demo-quick-play-seed.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  games,
  pelicanSchedules,
  pelicanServers,
  type NewPelicanSchedule,
  type NewPelicanServer,
} from '../../drizzle/schema';
import {
  offlineServerSchedules,
  runningServerSchedules,
} from './pelican-demo-seed-schedules.helpers';

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
  /** Stored schedules seeded for this row (ROK-1096). */
  scheduleCount: number;
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

/** ROK-1096 demo schedules per seeded row; most rows get none. */
function schedulesFor(
  kind: PelicanSeedKind,
  serverId: number,
  now: Date,
): NewPelicanSchedule[] {
  if (kind === 'running_mapped') return runningServerSchedules(serverId);
  if (kind === 'offline_unmapped') return offlineServerSchedules(serverId, now);
  return [];
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Wipe `pelican_servers` (schedules cascade) except the ROK-1800 Quick Play
 * smoke fixture rows, then insert `specs` + their schedules.
 */
async function resetDemoRows(
  tx: Tx,
  specs: SeedSpec[],
  now: Date,
): Promise<PelicanSeedServer[]> {
  await tx
    .delete(pelicanServers)
    .where(notInArray(pelicanServers.panelUuid, QUICK_PLAY_FIXTURE_UUIDS));
  const inserted = await tx
    .insert(pelicanServers)
    .values(specs.map((s) => s.values))
    .returning({
      id: pelicanServers.id,
      name: pelicanServers.name,
      panelUuid: pelicanServers.panelUuid,
    });
  const out = specs.flatMap((spec) => {
    const row = inserted.find((r) => r.panelUuid === spec.values.panelUuid);
    return row
      ? [{ spec, row, rows: schedulesFor(spec.kind, row.id, now) }]
      : [];
  });
  const schedules = out.flatMap((o) => o.rows);
  if (schedules.length > 0) await tx.insert(pelicanSchedules).values(schedules);
  return out.map(({ spec, row, rows }) => ({
    kind: spec.kind,
    id: row.id,
    name: row.name,
    scheduleCount: rows.length,
  }));
}

/**
 * Reset `pelican_servers` to the four demo rows plus their schedules
 * (re-run = reset). Returns `null` when there is no game to map.
 */
export async function seedDemoPelicanServers(
  db: Db,
  now: Date,
): Promise<PelicanSeedResult | null> {
  const game = await pickDemoGame(db);
  if (!game) return null;
  const specs = buildDemoServers(game.id, now);
  const servers = await db.transaction((tx) => resetDemoRows(tx, specs, now));
  return {
    gameId: game.id,
    gameName: game.name,
    servers,
  };
}

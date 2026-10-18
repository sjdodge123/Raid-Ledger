import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import {
  games,
  pelicanServers,
  valheimLinkTokens,
} from '../../../drizzle/schema';
import { QUICK_PLAY_FIXTURE_UUIDS } from '../../pelican/pelican-demo-quick-play-seed.helpers';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1833 Valheim Link token smoke + fleet plan fixture (DEMO_MODE). Each
 * Playwright worker owns a slot pair. The pair is taken from the TAIL of the
 * Quick Play fixture UUID range, which the Pelican demo reset
 * (`seed-servers`) already leaves alone — so a sibling worker's reset cannot
 * delete these rows mid-test. Quick Play slots count up from 0, these down
 * from the last one; they meet only past 16 parallel workers.
 */
export const VALHEIM_LINK_FIXTURE_SLOTS = 16;

export interface ValheimLinkFixtureRequest {
  slot: number;
  withToken: boolean;
}

export interface ValheimLinkFixtureRows {
  valheimServerId: number;
  otherServerId: number;
}

/** `true` when `v` is a valid fixture slot index. */
export function isValheimLinkFixtureSlot(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v < VALHEIM_LINK_FIXTURE_SLOTS
  );
}

/** `{ slot?, withToken? }` from an untrusted body (both optional), else `null`. */
export function parseValheimLinkFixtureRequest(
  body: unknown,
): ValheimLinkFixtureRequest | null {
  const obj: object = typeof body === 'object' && body !== null ? body : {};
  const slot = 'slot' in obj ? obj.slot : 0;
  const withToken = 'withToken' in obj ? obj.withToken : false;
  if (!isValheimLinkFixtureSlot(slot)) return null;
  if (typeof withToken !== 'boolean') return null;
  return { slot, withToken };
}

/** The slot's two `panel_uuid`s: [Valheim row, other-game row]. */
export function valheimLinkFixtureUuids(slot: number): [string, string] {
  const last = QUICK_PLAY_FIXTURE_UUIDS.length - 1;
  const a = QUICK_PLAY_FIXTURE_UUIDS[last - slot * 2];
  const b = QUICK_PLAY_FIXTURE_UUIDS[last - slot * 2 - 1];
  if (a === undefined || b === undefined) {
    throw new Error(`No fixture UUIDs for slot ${slot}`);
  }
  return [a, b];
}

/** Display names: slot 0 is the plain "Ashlands (demo)" the fleet plan names. */
export function valheimLinkFixtureNames(slot: number): [string, string] {
  const suffix = slot === 0 ? '' : ` #${slot}`;
  return [`Ashlands (demo)${suffix}`, `Meadows (demo, not Valheim)${suffix}`];
}

/** The Valheim game id, or `null` when the env has no Valheim game. */
export async function findValheimGameId(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.slug, VALHEIM_GAME_SLUG))
    .limit(1);
  return row?.id ?? null;
}

/** A stable non-Valheim game for the unmapped row, or `null` if none. */
export async function findOtherGameId(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        ne(games.slug, VALHEIM_GAME_SLUG),
        eq(games.hidden, false),
        eq(games.banned, false),
      ),
    )
    .orderBy(asc(games.name), asc(games.id))
    .limit(1);
  return row?.id ?? null;
}

function baseRow(now: Date) {
  // Off the calendar and the member status feed; offline, so no socket opens.
  return {
    presenceTracking: false,
    showOnCalendar: false,
    currentState: 'offline',
    statusCheckedAt: now,
    lastSyncedAt: now,
  };
}

function fixtureRows(
  slot: number,
  gameIds: { valheimGameId: number; otherGameId: number | null },
  now: Date,
) {
  const [vUuid, oUuid] = valheimLinkFixtureUuids(slot);
  const [vName, oName] = valheimLinkFixtureNames(slot);
  const base = baseRow(now);
  return [
    {
      ...base,
      panelUuid: vUuid,
      identifier: `vlfix${slot}v`,
      name: vName,
      gameId: gameIds.valheimGameId,
    },
    {
      ...base,
      panelUuid: oUuid,
      identifier: `vlfix${slot}o`,
      name: oName,
      gameId: gameIds.otherGameId,
    },
  ];
}

function upsertFixtureRows(
  db: Db,
  slot: number,
  gameIds: { valheimGameId: number; otherGameId: number | null },
  now: Date,
) {
  return db
    .insert(pelicanServers)
    .values(fixtureRows(slot, gameIds, now))
    .onConflictDoUpdate({
      target: pelicanServers.panelUuid,
      set: {
        name: sql`excluded.name`,
        gameId: sql`excluded.game_id`,
        presenceTracking: false,
        showOnCalendar: false,
        currentState: 'offline',
        isSuspended: false,
        missingSince: null,
      },
    })
    .returning({ id: pelicanServers.id, panelUuid: pelicanServers.panelUuid });
}

/**
 * Upsert the slot's two rows back to their initial state and delete any
 * token on them (re-run = reset to "no token").
 */
export async function seedValheimLinkFixtureRows(
  db: Db,
  slot: number,
  gameIds: { valheimGameId: number; otherGameId: number | null },
  now: Date,
): Promise<ValheimLinkFixtureRows> {
  const rows = await upsertFixtureRows(db, slot, gameIds, now);
  const [vUuid, oUuid] = valheimLinkFixtureUuids(slot);
  const idOf = (uuid: string) => rows.find((r) => r.panelUuid === uuid)?.id;
  const valheimServerId = idOf(vUuid);
  const otherServerId = idOf(oUuid);
  if (valheimServerId === undefined || otherServerId === undefined) {
    throw new Error('Valheim Link fixture upsert returned no row');
  }
  await db
    .delete(valheimLinkTokens)
    .where(
      inArray(valheimLinkTokens.pelicanServerId, [
        valheimServerId,
        otherServerId,
      ]),
    );
  return { valheimServerId, otherServerId };
}

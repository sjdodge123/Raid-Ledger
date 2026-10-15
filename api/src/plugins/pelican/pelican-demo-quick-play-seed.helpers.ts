import { inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { pelicanServers } from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1800 Quick Play switch smoke fixture (DEMO_MODE). Each Playwright
 * worker owns a slot: a mapped and an unmapped row nobody else edits. The
 * four-row demo reset (`seed-servers`) leaves these rows alone, so a sibling
 * spec re-seeding mid-run cannot pull them out from under the switch smoke.
 */
export const QUICK_PLAY_FIXTURE_SLOTS = 32;

function fixtureUuid(index: number): string {
  return `de300100-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function slotUuids(slot: number): [string, string] {
  return [fixtureUuid(slot * 2), fixtureUuid(slot * 2 + 1)];
}

/** Every fixture `panel_uuid` — excluded from the demo reset. */
export const QUICK_PLAY_FIXTURE_UUIDS = Array.from(
  { length: QUICK_PLAY_FIXTURE_SLOTS * 2 },
  (_, i) => fixtureUuid(i),
);

export interface QuickPlayFixtureRequest {
  slot: number;
  gameId: number;
}

export interface QuickPlayFixture {
  mappedId: number;
  unmappedId: number;
}

/** `true` when `v` is a valid fixture slot index. */
export function isFixtureSlot(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v < QUICK_PLAY_FIXTURE_SLOTS
  );
}

/** `{ slot, gameId }` from an untrusted body, else `null`. */
export function parseQuickPlayFixtureRequest(
  body: unknown,
): QuickPlayFixtureRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const slot = 'slot' in body ? body.slot : undefined;
  const gameId = 'gameId' in body ? body.gameId : undefined;
  if (!isFixtureSlot(slot)) return null;
  if (typeof gameId !== 'number' || !Number.isInteger(gameId)) return null;
  return { slot, gameId };
}

function fixtureRows(req: QuickPlayFixtureRequest, now: Date) {
  const [mapped, unmapped] = slotUuids(req.slot);
  const base = {
    presenceTracking: false,
    // Off the calendar and member status feed; offline, so no socket opens.
    showOnCalendar: false,
    currentState: 'offline',
    statusCheckedAt: now,
    lastSyncedAt: now,
  };
  return [
    {
      ...base,
      panelUuid: mapped,
      identifier: `qpfix${req.slot}m`,
      name: `Quick Play Fixture ${req.slot} — Mapped`,
      gameId: req.gameId,
    },
    {
      ...base,
      panelUuid: unmapped,
      identifier: `qpfix${req.slot}u`,
      name: `Quick Play Fixture ${req.slot} — Unmapped`,
      gameId: null,
    },
  ];
}

/** Upsert the slot's two rows back to their initial state (re-run = reset). */
export async function seedQuickPlayFixture(
  db: Db,
  req: QuickPlayFixtureRequest,
  now: Date,
): Promise<QuickPlayFixture> {
  const rows = await db
    .insert(pelicanServers)
    .values(fixtureRows(req, now))
    .onConflictDoUpdate({
      target: pelicanServers.panelUuid,
      set: {
        gameId: sql`excluded.game_id`,
        presenceTracking: false,
        showOnCalendar: false,
        currentState: 'offline',
        isSuspended: false,
        missingSince: null,
      },
    })
    .returning({ id: pelicanServers.id, panelUuid: pelicanServers.panelUuid });
  const [mappedUuid, unmappedUuid] = slotUuids(req.slot);
  const idOf = (uuid: string) => rows.find((r) => r.panelUuid === uuid)?.id;
  const mappedId = idOf(mappedUuid);
  const unmappedId = idOf(unmappedUuid);
  if (mappedId === undefined || unmappedId === undefined) {
    throw new Error('Quick Play fixture upsert returned no row');
  }
  return { mappedId, unmappedId };
}

/** Remove the slot's rows (smoke teardown). */
export async function deleteQuickPlayFixture(
  db: Db,
  slot: number,
): Promise<void> {
  await db
    .delete(pelicanServers)
    .where(inArray(pelicanServers.panelUuid, slotUuids(slot)));
}

/**
 * ROK-1933 L6a — the opt-in claim-suggest sighting for the claim-drive
 * fixture: one live Quick Play titled per worker (re-seeding replaces it) and
 * a Steam-only participant playing B's matching character on the server,
 * first seen 20 minutes ago (clears `CLAIM_SUGGEST_MIN_AGE_MS`).
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const MIN = 60_000;

/** The worker's fixture Quick Play title (the re-seed's delete key). */
export const claimDriveEventTitle = (worker: number): string =>
  `Claim drive fixture ${worker}`;

/** Delete the worker's previous fixture Quick Play (participants cascade). */
export async function clearClaimDriveSighting(
  db: Db,
  worker: number,
): Promise<void> {
  const E = schema.events;
  await db
    .delete(E)
    .where(and(eq(E.isAdHoc, true), eq(E.title, claimDriveEventTitle(worker))));
}

interface SightingInput {
  worker: number;
  serverId: number;
  gameId: number;
  creatorId: number;
  steamId: string;
  characterName: string;
}

/** The worker's live fixture Quick Play (±1h around now); returns its id. */
async function insertLiveQuickPlay(
  db: Db,
  input: SightingInput,
  now: number,
): Promise<number> {
  const E = schema.events;
  const [event] = await db
    .insert(E)
    .values({
      title: claimDriveEventTitle(input.worker),
      creatorId: input.creatorId,
      gameId: input.gameId,
      duration: [new Date(now - 60 * MIN), new Date(now + 60 * MIN)],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning({ id: E.id });
  if (!event)
    throw new Error('claim-drive fixture: event insert returned no row');
  return event.id;
}

/** Insert the live Quick Play + the Steam-only sighting; returns the event id. */
export async function insertClaimDriveSighting(
  db: Db,
  input: SightingInput,
): Promise<number> {
  const now = Date.now();
  const eventId = await insertLiveQuickPlay(db, input, now);
  await db.insert(schema.adHocParticipants).values({
    eventId,
    steamId: input.steamId,
    discordUsername: input.characterName,
    characterName: input.characterName,
    source: 'steam',
    inVoice: false,
    onServer: true,
    pelicanServerId: input.serverId,
    joinedAt: new Date(now - 20 * MIN),
  });
  return eventId;
}

/**
 * ROK-1931 — the Deaths fixture's one mod-reported death: a `source = 'mod'`
 * row for the `second` character on the fixture world, positioned well clear
 * (> 5 m) of that character's own Death pins so the read's 5 m dedupe keeps
 * it as a synthetic "Death · <date time>" pin. Dated between the character's
 * log deaths so "Counted since" does not move. A mod row is one death (D5),
 * so `second`'s bar counts it: the returned cast carries `deaths + 1`.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { DEATHS_FIXTURE_WORLD_UID } from './valheim-deaths-demo-seed.data';
import type { DeathsFixture } from './valheim-deaths-demo-seed.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type DeathInsert = typeof schema.valheimPlayerDeaths.$inferInsert;

/** Where the reported death lies (its own Death pin is at -900, -260). */
export const DEATHS_FIXTURE_REPORTED_XZ = { x: -700, z: -100 } as const;

/** 36 h before `now`: between the 1- and 2-day-old log deaths. */
const REPORTED_AGE_MS = 36 * 3_600_000;

/** `POST …/deaths-fixture`'s `reportedDeath`. */
export interface DeathsFixtureReported {
  characterId: number;
  /** ISO timestamp of the mod's `at`. */
  diedAt: string;
}

/** The owner profile's identity (the reported-deaths read joins on it). */
export interface ReportedOwner {
  serverId: number;
  name: string;
  steamId: string;
  playerId: string;
}

/** The `source = 'mod'` row (satisfies `valheim_player_deaths_mod_shape_check`). */
export function reportedDeathValues(
  owner: ReportedOwner,
  now: Date,
): DeathInsert {
  const at = new Date(now.getTime() - REPORTED_AGE_MS);
  return {
    pelicanServerId: owner.serverId,
    characterName: owner.name,
    steamId: owner.steamId,
    playerId: owner.playerId,
    worldUid: DEATHS_FIXTURE_WORLD_UID,
    source: 'mod',
    loggedAt: null,
    occurredAt: at,
    reportedAt: at,
    ...DEATHS_FIXTURE_REPORTED_XZ,
  };
}

async function ownerOf(
  db: Db,
  serverId: number,
  profileId: number,
): Promise<ReportedOwner> {
  const P = schema.valheimProfiles;
  const [row] = await db
    .select({ name: P.name, steamId: P.steamId, playerId: P.playerId })
    .from(P)
    .where(eq(P.id, profileId))
    .limit(1);
  if (!row) throw new Error('deaths fixture: reported owner not found');
  return { serverId, ...row };
}

/** Insert the reported death for `second`; returns the cast with its +1. */
export async function seedReportedDeath(
  db: Db,
  ctx: { serverId: number; now: Date },
  characters: DeathsFixture['characters'],
): Promise<{
  characters: DeathsFixture['characters'];
  reportedDeath: DeathsFixtureReported;
}> {
  const { second } = characters;
  const owner = await ownerOf(db, ctx.serverId, second.id);
  const values = reportedDeathValues(owner, ctx.now);
  await db.insert(schema.valheimPlayerDeaths).values(values);
  return {
    characters: {
      ...characters,
      second: { ...second, deaths: second.deaths + 1 },
    },
    reportedDeath: {
      characterId: second.id,
      diedAt: values.occurredAt.toISOString(),
    },
  };
}

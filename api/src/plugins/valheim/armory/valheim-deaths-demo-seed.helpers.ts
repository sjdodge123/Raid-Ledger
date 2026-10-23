/**
 * ROK-1930 L5 — DEMO_MODE Deaths fixture writes. Each worker slot gets its OWN
 * Valheim Pelican server + hub (never the link/armory or claim-drive servers),
 * reset on every call to: two characters with profiles and one map each on
 * one world (Death, non-death and shared pins), `valheim_player_deaths` rows
 * for both plus a name-only player, a hub member and a signed-in visitor.
 * Users are found by their per-worker Discord id, so a re-seed reuses them —
 * same ids every call (idempotent per worker).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { NewValheimMap, NewValheimProfile } from '../../../drizzle/schema';
import { ARMORY_FIXTURE_GAME_VERSION } from './valheim-armory-demo-seed.helpers';
import { fixtureSheet } from './valheim-armory-demo-sheet';
import {
  MAP_FIXTURE_EXPLORED,
  MAP_FIXTURE_GRID,
  MAP_FIXTURE_SHARED_EXPLORED,
} from './valheim-armory-map-demo-fixture';
import { MAP_PNG_SIZE } from './valheim-armory-map-demo-seed.helpers';
import {
  DEATHS_FIXTURE_CHARACTERS,
  DEATHS_FIXTURE_UNLINKED_DEATHS,
  DEATHS_FIXTURE_UNLINKED_NAME,
  DEATHS_FIXTURE_WORLD_NAME,
  DEATHS_FIXTURE_WORLD_UID,
  deathPinLabels,
  type DeathsFixtureCharacterPlan,
} from './valheim-deaths-demo-seed.data';

type Db = PostgresJsDatabase<typeof schema>;

/** A seeded user. */
export interface DeathsFixtureUser {
  id: number;
  username: string;
}

/** A seeded character with its map. */
export interface DeathsFixtureCharacter {
  id: number;
  name: string;
  mapId: number;
  deaths: number;
  /** The Map tab's readable names of this character's Death pins. */
  deathPinLabels: string[];
}

/** `POST /admin/test/valheim/deaths-fixture` response. */
export interface DeathsFixture {
  serverId: number;
  guildId: number;
  worldUid: string;
  /** `member`: a manual hub member. `visitor`: onboarded, not a member. */
  users: { member: DeathsFixtureUser; visitor: DeathsFixtureUser };
  /** `top` (5 deaths, SteamID-attributed), `second` (3, NULL SteamID → by name). */
  characters: { top: DeathsFixtureCharacter; second: DeathsFixtureCharacter };
  /** The name-only player's bar (no character → not a link). */
  unlinked: { name: string; deaths: number };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The SteamID64 of the worker's `k`th fixture character (17 digits). */
export function deathsSteamId(worker: number, k: number): string {
  return `76561198019300${pad2(worker)}${k}`;
}

/** The worker's per-role Discord id (19 digits; stable → users are reused). */
export function deathsDiscordId(worker: number, role: 0 | 1): string {
  return `193019301930193${pad2(worker)}${role}0`;
}

/** Find-or-insert the worker's onboarded user for `role` (0 member, 1 visitor). */
async function ensureUser(
  db: Db,
  worker: number,
  role: 0 | 1,
): Promise<DeathsFixtureUser> {
  const U = schema.users;
  const discordId = deathsDiscordId(worker, role);
  const username = `${role === 0 ? 'dthM' : 'dthV'}${worker}`;
  const [found] = await db
    .select({ id: U.id, username: U.username })
    .from(U)
    .where(eq(U.discordId, discordId))
    .limit(1);
  if (found) return found;
  const displayName =
    role === 0 ? `Deathmember ${worker}` : `Deathvisitor ${worker}`;
  const [row] = await db
    .insert(U)
    .values({
      username,
      displayName,
      discordId,
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: U.id, username: U.username });
  if (!row) throw new Error('deaths fixture: user insert returned no row');
  return row;
}

/** The member (manual hub member) and the visitor (membership removed). */
export async function ensureDeathsUsers(
  db: Db,
  worker: number,
  guildId: number,
): Promise<DeathsFixture['users']> {
  const member = await ensureUser(db, worker, 0);
  const visitor = await ensureUser(db, worker, 1);
  const M = schema.hubServerMembers;
  await db
    .insert(M)
    .values({
      guildId,
      userId: member.id,
      source: 'manual',
      joinedAt: new Date(),
    })
    .onConflictDoNothing();
  await db.delete(M).where(eq(M.userId, visitor.id));
  return { member, visitor };
}

function profileValues(
  serverId: number,
  worker: number,
  k: number,
  name: string,
): NewValheimProfile {
  return {
    pelicanServerId: serverId,
    steamId: deathsSteamId(worker, k),
    playerId: `19300000000${pad2(worker)}${k}`,
    name,
    worldUid: DEATHS_FIXTURE_WORLD_UID,
    worldName: DEATHS_FIXTURE_WORLD_NAME,
    claimedBy: null,
    claimSource: null,
    claimedAt: null,
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    modVersion: '1.0.0',
    capturedAt: new Date(),
    sourceSnapshotId: null,
    ...fixtureSheet(false),
    knownItems: [],
    knownRecipes: [],
  };
}

function mapValues(
  serverId: number,
  profile: NewValheimProfile & { id: number },
  pins: NewValheimMap['pins'],
  baseMapSha256: string,
): NewValheimMap {
  return {
    pelicanServerId: serverId,
    worldUid: DEATHS_FIXTURE_WORLD_UID,
    steamId: profile.steamId,
    playerId: profile.playerId,
    profileId: profile.id,
    ...MAP_FIXTURE_GRID,
    explored: MAP_FIXTURE_EXPLORED,
    sharedExplored: MAP_FIXTURE_SHARED_EXPLORED,
    pins,
    baseMapSha256,
    baseMapWidth: MAP_PNG_SIZE,
    baseMapHeight: MAP_PNG_SIZE,
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    capturedAt: new Date(),
  };
}

/** Wipe the server's maps, characters and deaths (the fixture owns the server). */
export async function resetDeathsServer(
  db: Db,
  serverId: number,
): Promise<void> {
  await db
    .delete(schema.valheimMaps)
    .where(eq(schema.valheimMaps.pelicanServerId, serverId));
  await db
    .delete(schema.valheimProfiles)
    .where(eq(schema.valheimProfiles.pelicanServerId, serverId));
  const D = schema.valheimPlayerDeaths;
  await db.delete(D).where(eq(D.pelicanServerId, serverId));
}

/** `n` log-sourced deaths a day apart, ending yesterday (zone-less `loggedAt`). */
function deathRows(
  serverId: number,
  characterName: string,
  steamId: string | null,
  n: number,
  now: Date,
): Array<typeof schema.valheimPlayerDeaths.$inferInsert> {
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(now.getTime() - (i + 1) * 86_400_000);
    return {
      pelicanServerId: serverId,
      characterName,
      steamId,
      source: 'log',
      loggedAt: at.toISOString().slice(0, 19),
      occurredAt: at,
    };
  });
}

async function insertDeaths(
  db: Db,
  rows: Array<typeof schema.valheimPlayerDeaths.$inferInsert>,
): Promise<void> {
  await db.insert(schema.valheimPlayerDeaths).values(rows);
}

async function insertMap(db: Db, values: NewValheimMap): Promise<number> {
  const M = schema.valheimMaps;
  const [map] = await db.insert(M).values(values).returning({ id: M.id });
  if (!map) throw new Error('deaths fixture: map insert returned no row');
  return map.id;
}

async function seedCharacter(
  db: Db,
  ctx: { serverId: number; worker: number; baseMapSha256: string; now: Date },
  plan: DeathsFixtureCharacterPlan,
  k: number,
): Promise<DeathsFixtureCharacter> {
  const values = profileValues(ctx.serverId, ctx.worker, k, plan.name);
  const P = schema.valheimProfiles;
  const [profile] = await db.insert(P).values(values).returning({ id: P.id });
  if (!profile)
    throw new Error('deaths fixture: profile insert returned no row');
  const mapId = await insertMap(
    db,
    mapValues(
      ctx.serverId,
      { ...values, id: profile.id },
      plan.pins,
      ctx.baseMapSha256,
    ),
  );
  const steamId = plan.steamAttributed ? values.steamId : null;
  await insertDeaths(
    db,
    deathRows(ctx.serverId, plan.name, steamId, plan.deaths, ctx.now),
  );
  return {
    id: profile.id,
    name: plan.name,
    mapId,
    deaths: plan.deaths,
    deathPinLabels: deathPinLabels(plan),
  };
}

/** Both characters (+ maps + deaths) and the name-only player's deaths. */
export async function seedDeathsCast(
  db: Db,
  ctx: { serverId: number; worker: number; baseMapSha256: string; now: Date },
): Promise<Pick<DeathsFixture, 'characters' | 'unlinked'>> {
  const [topPlan, secondPlan] = DEATHS_FIXTURE_CHARACTERS;
  if (!topPlan || !secondPlan)
    throw new Error('deaths fixture: cast plan incomplete');
  const top = await seedCharacter(db, ctx, topPlan, 0);
  const second = await seedCharacter(db, ctx, secondPlan, 1);
  await db
    .insert(schema.valheimPlayerDeaths)
    .values(
      deathRows(
        ctx.serverId,
        DEATHS_FIXTURE_UNLINKED_NAME,
        null,
        DEATHS_FIXTURE_UNLINKED_DEATHS,
        ctx.now,
      ),
    );
  return {
    characters: { top, second },
    unlinked: {
      name: DEATHS_FIXTURE_UNLINKED_NAME,
      deaths: DEATHS_FIXTURE_UNLINKED_DEATHS,
    },
  };
}

/**
 * ROK-1933 L6a — DEMO_MODE claim-drive fixture writes. Each worker slot gets
 * its OWN Valheim Pelican server + hub (never the link/armory slot server,
 * whose c1…c3 characters other specs leave behind), reset on every call to
 * exactly three characters: one claimed by a fresh user A, two unclaimed —
 * one named exactly like a fresh user B's display name. Fresh users per call
 * keep each test's banner state (and the DM dedupe keys) apart. All names
 * are invented.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { NewValheimProfile } from '../../../drizzle/schema';
import {
  ARMORY_FIXTURE_GAME_VERSION,
  ensureArmoryCatalog,
} from './valheim-armory-demo-seed.helpers';
import { fixtureSheet } from './valheim-armory-demo-sheet';
import { ensureFixtureHubId } from './valheim-armory-map-hub.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Character names (invented). B's matching character takes B's display name. */
export const CLAIM_DRIVE_CLAIMED_NAME = 'Ragnvidr';
export const CLAIM_DRIVE_OTHER_NAME = 'Kettilvar';
const B_NAME_STEM = 'Brynjolf';

/** A seeded user. */
export interface ClaimDriveUser {
  id: number;
  username: string;
  displayName: string;
}

/** A seeded character. */
export interface ClaimDriveCharacter {
  id: number;
  name: string;
}

/** `POST /admin/test/valheim/claim-drive-fixture` response. */
export interface ClaimDriveFixture {
  serverId: number;
  guildId: number;
  /** A: owns `claimed`. B: no claim; `matching` carries B's display name. */
  users: { a: ClaimDriveUser; b: ClaimDriveUser };
  characters: {
    claimed: ClaimDriveCharacter;
    matching: ClaimDriveCharacter;
    other: ClaimDriveCharacter;
  };
  /** The live Quick Play holding B's sighting, or null without `sighting`. */
  eventId: number | null;
}

/** Parsed request. */
export interface ClaimDriveRequest {
  worker: number;
  sighting: boolean;
  bDiscordId: string | null;
  /** Appended to the server/hub name (`Claimheim <worker> <suffix>`), or null. */
  nameSuffix: string | null;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The worker's server (and hub) name: `Claimheim <worker>[ <suffix>]`. */
export function claimDriveServerName(
  worker: number,
  nameSuffix: string | null,
): string {
  const base = `Claimheim ${worker}`;
  return nameSuffix ? `${base} ${nameSuffix}` : base;
}

/** The worker's fixture server's (stable) Pelican panel UUID. */
export function claimDrivePanelUuid(worker: number): string {
  return `00000000-0000-4000-8000-0000001933${pad2(worker)}`;
}

/** Username prefixes of users A and B (`<prefix><fixtureTag>`). */
export const CLAIM_DRIVE_USERNAME_PREFIXES = ['cdA', 'cdB'] as const;

/** Upsert the worker's own Valheim server row; returns its id. */
export async function upsertClaimDriveServer(
  db: Db,
  worker: number,
  gameId: number,
  name: string,
): Promise<number> {
  const S = schema.pelicanServers;
  const [row] = await db
    .insert(S)
    .values({
      panelUuid: claimDrivePanelUuid(worker),
      identifier: `cdfix${worker}v`,
      name,
      gameId,
      presenceTracking: false,
      showOnCalendar: false,
    })
    .onConflictDoUpdate({ target: S.panelUuid, set: { name, gameId } })
    .returning({ id: S.id });
  if (!row)
    throw new Error('claim-drive fixture: server upsert returned no row');
  return row.id;
}

/**
 * The worker's server + its visible hub (catalogue inserted when absent).
 * The hub is renamed to the server's name on every call, so a per-run
 * `nameSuffix` reaches an already-existing hub too.
 */
export async function ensureClaimDriveHub(
  db: Db,
  worker: number,
  gameId: number,
  nameSuffix: string | null = null,
): Promise<{ serverId: number; guildId: number }> {
  const name = claimDriveServerName(worker, nameSuffix);
  const serverId = await upsertClaimDriveServer(db, worker, gameId, name);
  await ensureArmoryCatalog(db, serverId);
  const guildId = await ensureFixtureHubId(db, serverId, gameId);
  const G = schema.guilds;
  await db
    .update(G)
    .set({ name, nameKey: name.toLowerCase() })
    .where(eq(G.id, guildId));
  return { serverId, guildId };
}

/** A per-call unique tag: worker + base36 clock + 2 random chars. */
export function fixtureTag(worker: number): string {
  const rnd = Math.floor(Math.random() * 1296).toString(36);
  return `${worker}${Date.now().toString(36)}${rnd}`;
}

/** Insert one onboarded user who is a manual member of the hub. */
export async function insertHubUser(
  db: Db,
  guildId: number,
  user: { username: string; displayName: string; discordId: string },
): Promise<ClaimDriveUser> {
  const U = schema.users;
  const [row] = await db
    .insert(U)
    .values({ ...user, onboardingCompletedAt: new Date() })
    .returning({ id: U.id });
  if (!row) throw new Error('claim-drive fixture: user insert returned no row');
  await db.insert(schema.hubServerMembers).values({
    guildId,
    userId: row.id,
    source: 'manual',
    joinedAt: new Date(),
  });
  return { id: row.id, username: user.username, displayName: user.displayName };
}

/**
 * Two distinct generated Discord ids for users A and B: `19` + the 13-digit
 * clock + 3 random digits + 1/2 = 19 digits, inside the route's own
 * `bDiscordId` rule (17–20), so a caller can echo one back as `bDiscordId`.
 */
export function claimDriveSnowflakes(): { a: string; b: string } {
  const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const snow = `19${Date.now()}${rnd}`;
  return { a: `${snow}1`, b: `${snow}2` };
}

/** Users A and B; B's Discord id is `bDiscordId` when given. */
export async function insertClaimDriveUsers(
  db: Db,
  guildId: number,
  tag: string,
  bDiscordId: string | null,
): Promise<{ a: ClaimDriveUser; b: ClaimDriveUser }> {
  const snow = claimDriveSnowflakes();
  const a = await insertHubUser(db, guildId, {
    username: `${CLAIM_DRIVE_USERNAME_PREFIXES[0]}${tag}`,
    displayName: `Ashgrim ${tag}`.slice(0, 30),
    discordId: snow.a,
  });
  const b = await insertHubUser(db, guildId, {
    username: `${CLAIM_DRIVE_USERNAME_PREFIXES[1]}${tag}`,
    displayName: `${B_NAME_STEM}${tag}`.slice(0, 30),
    discordId: bDiscordId ?? snow.b,
  });
  return { a, b };
}

function characterValues(
  serverId: number,
  worker: number,
  k: number,
  name: string,
  claimedBy: number | null,
): NewValheimProfile {
  return {
    pelicanServerId: serverId,
    steamId: claimDriveSteamId(worker, k),
    playerId: `19330000000${pad2(worker)}${k}`,
    name,
    worldUid: '1933193319331',
    worldName: 'Claimheim',
    claimedBy,
    claimSource: claimedBy === null ? null : 'admin',
    claimedAt: claimedBy === null ? null : new Date(),
    gameVersion: ARMORY_FIXTURE_GAME_VERSION,
    modVersion: '1.0.0',
    capturedAt: new Date(),
    sourceSnapshotId: null,
    ...fixtureSheet(false),
    knownItems: [],
    knownRecipes: [],
  };
}

/** The SteamID64 of the worker's `k`th fixture character (17 digits). */
export function claimDriveSteamId(worker: number, k: number): string {
  return `76561198019330${pad2(worker)}${k}`;
}

/** Drop every character on the server, then insert the three fixture ones. */
export async function resetClaimDriveCharacters(
  db: Db,
  serverId: number,
  worker: number,
  users: { a: ClaimDriveUser; b: ClaimDriveUser },
): Promise<ClaimDriveFixture['characters']> {
  const P = schema.valheimProfiles;
  await db.delete(P).where(eq(P.pelicanServerId, serverId));
  const plan: Array<[string, number | null]> = [
    [CLAIM_DRIVE_CLAIMED_NAME, users.a.id],
    [users.b.displayName, null],
    [CLAIM_DRIVE_OTHER_NAME, null],
  ];
  const rows = await db
    .insert(P)
    .values(
      plan.map(([n, by], k) => characterValues(serverId, worker, k, n, by)),
    )
    .returning({ id: P.id, name: P.name });
  const [claimed, matching, other] = rows;
  if (!claimed || !matching || !other) {
    throw new Error(
      'claim-drive fixture: character insert returned too few rows',
    );
  }
  return { claimed, matching, other };
}

/** True when another user already holds `discordId`. */
export async function discordIdTaken(
  db: Db,
  discordId: string,
): Promise<boolean> {
  const U = schema.users;
  const [hit] = await db
    .select({ id: U.id })
    .from(U)
    .where(eq(U.discordId, discordId))
    .limit(1);
  return hit !== undefined;
}

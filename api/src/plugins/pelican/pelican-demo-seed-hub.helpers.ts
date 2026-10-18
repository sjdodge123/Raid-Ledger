import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { PelicanTx } from './pelican-plugin-lock.helpers';
import { applyCommunityHub } from './hub/server-hub-toggle.helpers';
import { refreshMemberCount } from './hub/server-hub-membership.queries';

type Db = PostgresJsDatabase<typeof schema>;
const DAY_MS = 86_400_000;

/**
 * ROK-1831 server-hub demo fixture (DEMO_MODE). Slot 0 is the fleet test
 * plan's hub; each Playwright worker owns slot `1 + parallelIndex`, so the
 * desktop and mobile workers never toggle or join each other's hub. The
 * four-row demo reset (`seed-servers`) leaves these servers alone.
 */
export const SERVER_HUB_FIXTURE_SLOTS = 16;

/** The cast: four with a member row (D lapsed past 90 d), plus an outsider. */
export type ServerHubRole =
  'online' | 'recent' | 'joined' | 'lapsed' | 'outsider';
const ROLES: ServerHubRole[] = [
  'online',
  'recent',
  'joined',
  'lapsed',
  'outsider',
];

export interface ServerHubFixture {
  serverId: number;
  guildId: number;
  gameId: number;
  eventId: number;
  userIds: Record<ServerHubRole, number>;
}

function hubFixtureUuid(slot: number): string {
  return `de300200-0000-4000-8000-${String(slot).padStart(12, '0')}`;
}

/** Every hub fixture `panel_uuid` — excluded from the demo reset. */
export const SERVER_HUB_FIXTURE_UUIDS = Array.from(
  { length: SERVER_HUB_FIXTURE_SLOTS },
  (_, i) => hubFixtureUuid(i),
);

/** The slot from an untrusted body (`{}` → 0), else `null`. */
export function parseServerHubSlot(body: unknown): number | null {
  const raw =
    typeof body === 'object' && body !== null && 'slot' in body ? body.slot : 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 0 && raw < SERVER_HUB_FIXTURE_SLOTS ? raw : null;
}

/** The display name the hub's Members list shows for a cast member. */
export function serverHubUserName(slot: number, role: ServerHubRole): string {
  return `Hub ${slot} ${role[0]?.toUpperCase() ?? ''}${role.slice(1)}`;
}

type MemberRow = Partial<typeof schema.hubServerMembers.$inferInsert>;

/** Days ago of [first seen, last seen] per presence role, and its character. */
const PRESENCE_CAST: Partial<Record<ServerHubRole, [number, number, string]>> =
  {
    online: [30, 0, 'Bjorn'],
    recent: [40, 10, 'Sigrun'],
    lapsed: [130, 100, 'Ulf'],
  };

/** The `hub_server_members` row per member role (outsider has none). */
export function memberRowFor(role: ServerHubRole, now: Date): MemberRow | null {
  const ago = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
  if (role === 'joined') return { source: 'manual', joinedAt: ago(2) };
  const cast = PRESENCE_CAST[role];
  if (!cast) return null;
  const [first, last, characterName] = cast;
  return {
    source: 'presence',
    firstSeenAt: ago(first),
    lastSeenAt: ago(last),
    characterName,
  };
}

async function upsertUser(
  tx: PelicanTx,
  slot: number,
  role: ServerHubRole,
): Promise<number> {
  const name = serverHubUserName(slot, role);
  const [row] = await tx
    .insert(schema.users)
    .values({
      discordId: `demo-server-hub-${slot}-${role}`,
      username: name,
      displayName: name,
      role: 'member',
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.users.discordId,
      set: { deactivatedAt: null, displayName: name },
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error(`server-hub ${role} user upsert returned no row`);
  return row.id;
}

async function upsertUsers(
  tx: PelicanTx,
  slot: number,
): Promise<Record<ServerHubRole, number>> {
  const ids: Partial<Record<ServerHubRole, number>> = {};
  for (const role of ROLES) ids[role] = await upsertUser(tx, slot, role);
  const { online, recent, joined, lapsed, outsider } = ids;
  if (!online || !recent || !joined || !lapsed || !outsider) {
    throw new Error('server-hub user upsert incomplete');
  }
  return { online, recent, joined, lapsed, outsider };
}

function serverValues(slot: number, gameId: number, now: Date) {
  return {
    identifier: `hubfix${slot}`,
    name: `Demo Valheim Hub ${slot}`,
    gameId,
    currentState: 'running',
    statusCheckedAt: now,
    lastSyncedAt: now,
    presenceTracking: false,
    showOnCalendar: false,
    isSuspended: false,
    missingSince: null,
  };
}

/** Upsert the slot's Valheim-mapped, running server (no socket: presence off). */
async function upsertServer(
  tx: PelicanTx,
  slot: number,
  gameId: number,
  now: Date,
) {
  const set = serverValues(slot, gameId, now);
  const [row] = await tx
    .insert(schema.pelicanServers)
    .values({ ...set, panelUuid: hubFixtureUuid(slot) })
    .onConflictDoUpdate({ target: schema.pelicanServers.panelUuid, set })
    .returning({
      id: schema.pelicanServers.id,
      name: schema.pelicanServers.name,
    });
  if (!row) throw new Error('server-hub server upsert returned no row');
  return row;
}

async function hubGuildId(tx: PelicanTx, serverId: number): Promise<number> {
  const g = schema.guilds;
  const [row] = await tx
    .select({ id: g.id })
    .from(g)
    .where(eq(g.pelicanServerId, serverId))
    .limit(1);
  if (!row) throw new Error('server-hub toggle created no guild');
  return row.id;
}

/** Replace every member row with the cast's initial state. */
async function resetMembers(
  tx: PelicanTx,
  guildId: number,
  users: Record<ServerHubRole, number>,
  now: Date,
) {
  const m = schema.hubServerMembers;
  await tx.delete(m).where(eq(m.guildId, guildId));
  const rows = ROLES.flatMap((role) => {
    const row = memberRowFor(role, now);
    return row === null
      ? []
      : [{ source: 'presence' as const, ...row, guildId, userId: users[role] }];
  });
  await tx.insert(m).values(rows);
  await refreshMemberCount(tx, guildId, now);
}

interface QuickPlaySeed {
  serverId: number;
  gameId: number;
  creatorId: number;
  duration: [Date, Date];
}

async function insertQuickPlay(
  tx: PelicanTx,
  q: QuickPlaySeed,
): Promise<number> {
  const [event] = await tx
    .insert(schema.events)
    .values({
      title: 'Quick Play — Valheim',
      gameId: q.gameId,
      creatorId: q.creatorId,
      duration: q.duration,
      isAdHoc: true,
      adHocStatus: 'ended',
    })
    .returning({ id: schema.events.id });
  if (!event) throw new Error('server-hub quick play insert returned no row');
  await tx.insert(schema.adHocParticipants).values({
    eventId: event.id,
    userId: q.creatorId,
    // A steam row must carry an identity (`ad_hoc_participants_identity_check`).
    steamId: `7656119900${String(q.serverId).padStart(7, '0')}`,
    discordUsername: 'Bjorn',
    source: 'steam',
    inVoice: false,
    onServer: false,
    pelicanServerId: q.serverId,
    characterName: 'Bjorn',
    joinedAt: q.duration[0],
  });
  return event.id;
}

/** One ended Quick Play session 3 h ago on the server, reused on a re-run. */
async function upsertQuickPlay(
  tx: PelicanTx,
  q: Omit<QuickPlaySeed, 'duration'>,
  now: Date,
): Promise<number> {
  const hour = 3_600_000;
  const duration: [Date, Date] = [
    new Date(now.getTime() - 3 * hour),
    new Date(now.getTime() - 2 * hour),
  ];
  const p = schema.adHocParticipants;
  const [existing] = await tx
    .select({ eventId: p.eventId })
    .from(p)
    .where(eq(p.pelicanServerId, q.serverId))
    .limit(1);
  if (!existing) return insertQuickPlay(tx, { ...q, duration });
  await tx
    .update(schema.events)
    .set({ duration, adHocStatus: 'ended' })
    .where(eq(schema.events.id, existing.eventId));
  return existing.eventId;
}

/** The Valheim game id, or `null` when the env has no Valheim row. */
export async function findValheimGameId(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, 'valheim'))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Reset the slot's server hub (re-run = same server, guild and users): the
 * hub on and visible, members online / seen 10 d / joined-never-played /
 * seen 100 d (not a member), an outsider, one past Quick Play session.
 */
export async function seedServerHub(
  db: Db,
  slot: number,
  gameId: number,
  now: Date,
): Promise<ServerHubFixture> {
  return db.transaction(async (tx) => {
    const userIds = await upsertUsers(tx, slot);
    const server = await upsertServer(tx, slot, gameId, now);
    await applyCommunityHub(
      tx,
      { id: server.id, name: server.name, gameId },
      true,
      now,
    );
    const guildId = await hubGuildId(tx, server.id);
    const quickPlay = {
      serverId: server.id,
      gameId,
      creatorId: userIds.online,
    };
    const eventId = await upsertQuickPlay(tx, quickPlay, now);
    await resetMembers(tx, guildId, userIds, now);
    return { serverId: server.id, guildId, gameId, eventId, userIds };
  });
}

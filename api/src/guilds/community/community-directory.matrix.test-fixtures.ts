/**
 * ROK-1875 §6 / ROK-1883 — the shared hub-directory matrix for the `/hubs`
 * and `/hubs/by-game` integration specs: C1–C4 community, S1–S2 server,
 * W1–W3 WoW; viewers U1, U2 and the seeded admin. `setupMatrixSuite()`
 * registers the Pelican + WoW activation hooks (real `PluginRegistryService`,
 * no `jest.mock`) and the per-test truncate.
 */
import type { UserRole } from '@raid-ledger/contract';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import * as schema from '../../drizzle/schema';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../../plugins/wow-common/manifest';

export type Kind = 'wow_guild' | 'game_server' | 'game_community';
type Status = 'proposed' | 'active' | 'archived';
export type Auth = { Authorization: string };
interface HubOpts {
  kind: Kind;
  status?: Status;
  hidden?: boolean;
  members?: number;
}

const DAY = 86_400_000;
const SNAP = new Date('2026-10-10T20:00:00.000Z');
export const ALL_KINDS = ['wow_guild', 'game_server', 'game_community'];
const PLUGINS = [PELICAN_PLUGIN_ID, WOW_COMMON_MANIFEST.id];

let testApp: TestApp;

/** The suite's app (set by `setupMatrixSuite`'s `beforeAll`). */
export const app = (): TestApp => testApp;
let seq = 0;
let wasActive: Record<string, boolean> = {};
export const registry = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

/** A plain user (or `role`). */
export async function seedUser(username: string, role: UserRole = 'member') {
  seq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:dir-${seq}`, username, role })
      .returning(),
    `user ${username}`,
  );
  return user;
}

/** A bearer header for `user`. */
export async function authOf(
  user: typeof schema.users.$inferSelect,
): Promise<Auth> {
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  return { Authorization: `Bearer ${token}` };
}

/** One hub on the seed game. */
export async function seedHub(name: string, o: HubOpts): Promise<number> {
  const status = o.status ?? 'active';
  const community = o.kind === 'game_community';
  const archived = status === 'archived';
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: o.kind,
        region: community ? 'community' : 'us',
        source: community
          ? 'community'
          : o.kind === 'wow_guild'
            ? 'addon_import'
            : 'pelican',
        name,
        nameKey: name.toLowerCase(),
        status,
        memberCount: o.members ?? 0,
        hiddenAt: o.hidden ? new Date() : null,
        lastSnapshotAt: o.kind === 'wow_guild' ? SNAP : null,
        archivedAt: archived ? new Date() : null,
        archivedReason: archived ? 'admin' : null,
        proposedBy: status === 'proposed' ? testApp.seed.adminUser.id : null,
      })
      .returning(),
    `hub ${name}`,
  );
  return hub.id;
}

/** A live community membership. */
export async function joinCommunity(
  guildId: number,
  userId: number,
): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

/** A server-hub row: a live manual Join, or a presence sighting `daysAgo`. */
export async function serverMember(
  guildId: number,
  userId: number,
  daysAgo?: number,
) {
  const seen =
    daysAgo === undefined ? null : new Date(Date.now() - daysAgo * DAY);
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId,
    userId,
    source: seen === null ? 'manual' : 'presence',
    joinedAt: seen === null ? new Date() : null,
    lastSeenAt: seen,
  });
}

/** A character linked by GUID to a live `guild_members` row (WoW D3). */
export async function linkWow(guildId: number, userId: number): Promise<void> {
  seq += 1;
  const guid = `Player-1-dir${seq}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: `Char${seq}`,
    addonGuid: guid,
    region: 'us',
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: `Char${seq}`,
    rankIndex: 3,
    source: 'addon_import',
    lastSeenAt: SNAP,
  });
}

export interface Matrix {
  ids: Record<string, number>;
  u1: Auth;
  u2: Auth;
  admin: Auth;
}

/** The §6 fixture: C1–C4 community, S1–S2 server, W1–W3 WoW; U1, U2, A. */
export async function seedMatrix(): Promise<Matrix> {
  const u1 = await seedUser('dir-u1');
  const u2 = await seedUser('dir-u2');
  const ids: Record<string, number> = {
    C1: await seedHub('C1 Crew', { kind: 'game_community', members: 3 }),
    C2: await seedHub('C2 Crew', {
      kind: 'game_community',
      status: 'proposed',
    }),
    C3: await seedHub('C3 Crew', {
      kind: 'game_community',
      status: 'archived',
    }),
    C4: await seedHub('C4 Crew', { kind: 'game_community', hidden: true }),
    S1: await seedHub('S1 Server', { kind: 'game_server', members: 7 }),
    S2: await seedHub('S2 Server', { kind: 'game_server', hidden: true }),
    W1: await seedHub('W1 Guild', { kind: 'wow_guild', members: 120 }),
    W2: await seedHub('W2 Guild', { kind: 'wow_guild', members: 40 }),
    W3: await seedHub('W3 Guild', { kind: 'wow_guild', hidden: true }),
  };
  await joinCommunity(must(ids.C1), u1.id);
  await serverMember(must(ids.S1), u1.id);
  await linkWow(must(ids.W1), u1.id);
  await linkWow(must(ids.W3), u1.id);
  const admin = await authOf(testApp.seed.adminUser);
  return { ids, u1: await authOf(u1), u2: await authOf(u2), admin };
}

/** A fixture id, or a loud failure. */
export function must(n: number | undefined): number {
  if (n === undefined) throw new Error('fixture id missing');
  return n;
}

export interface Entry {
  id: number;
  kind: string;
  viewer: string;
  leaderName: string | null;
  memberCount: number;
  hidden?: boolean;
}
export interface PageBody {
  items: Entry[];
  nextCursor: string | null;
  total: number;
  kinds: string[];
}

/** `GET /hubs` (200 asserted). */
export async function getHubs(auth: Auth, query = ''): Promise<PageBody> {
  const res = await testApp.request.get(`/hubs${query}`).set(auth);
  expect(res.status).toBe(200);
  return res.body as PageBody;
}

/** The fixture names of a page's items, sorted. */
export function namesOf(m: Matrix, body: PageBody): string[] {
  const byId = new Map(Object.entries(m.ids).map(([k, v]) => [v, k]));
  return body.items.map((e) => byId.get(e.id) ?? `?${e.id}`).sort();
}

/** Register the plugin activation + truncate hooks for a matrix suite. */
export function setupMatrixSuite(): void {
  beforeAll(async () => {
    testApp = await getTestApp();
    wasActive = Object.fromEntries(
      PLUGINS.map((p) => [p, registry().isActive(p)]),
    );
  });

  beforeEach(async () => {
    for (const p of PLUGINS) {
      await registry().ensureInstalled(p);
      if (!registry().isActive(p)) await registry().activate(p);
    }
  });

  afterEach(async () => {
    for (const p of PLUGINS) {
      if (!wasActive[p] && registry().isActive(p))
        await registry().deactivate(p);
      if (wasActive[p] && !registry().isActive(p)) await registry().activate(p);
    }
    testApp.seed = await truncateAllTables(testApp.db);
  });
}

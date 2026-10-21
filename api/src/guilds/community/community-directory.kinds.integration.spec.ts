/**
 * ROK-1875 §6 — `GET /hubs` across every hub kind against a real DB: each
 * kind's own visibility rule (D8), adapter-sourced membership (D9), the
 * `kind` filter, the live `kinds` list, and keyset paging over mixed kinds.
 *
 * Pelican and WoW are activated through the real `PluginRegistryService`
 * (no `jest.mock` — it never reaches the singleton app); the "plugin off"
 * case deactivates Pelican the same way.
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

type Kind = 'wow_guild' | 'game_server' | 'game_community';
type Status = 'proposed' | 'active' | 'archived';
type Auth = { Authorization: string };
interface HubOpts {
  kind: Kind;
  status?: Status;
  hidden?: boolean;
  members?: number;
}

const DAY = 86_400_000;
const SNAP = new Date('2026-10-10T20:00:00.000Z');
const ALL_KINDS = ['wow_guild', 'game_server', 'game_community'];
const PLUGINS = [PELICAN_PLUGIN_ID, WOW_COMMON_MANIFEST.id];

let testApp: TestApp;
let seq = 0;
let wasActive: Record<string, boolean> = {};
const registry = () => testApp.app.get(PluginRegistryService);

async function seedUser(username: string, role: UserRole = 'member') {
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

async function authOf(user: typeof schema.users.$inferSelect): Promise<Auth> {
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  return { Authorization: `Bearer ${token}` };
}

async function seedHub(name: string, o: HubOpts): Promise<number> {
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

async function joinCommunity(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

/** A server-hub row: a live manual Join, or a presence sighting `daysAgo`. */
async function serverMember(guildId: number, userId: number, daysAgo?: number) {
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
async function linkWow(guildId: number, userId: number): Promise<void> {
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

interface Matrix {
  ids: Record<string, number>;
  u1: Auth;
  u2: Auth;
  admin: Auth;
}

/** The §6 fixture: C1–C4 community, S1–S2 server, W1–W3 WoW; U1, U2, A. */
async function seedMatrix(): Promise<Matrix> {
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

function must(n: number | undefined): number {
  if (n === undefined) throw new Error('fixture id missing');
  return n;
}

interface Entry {
  id: number;
  kind: string;
  viewer: string;
  leaderName: string | null;
  memberCount: number;
}
interface PageBody {
  items: Entry[];
  nextCursor: string | null;
  total: number;
  kinds: string[];
}

async function getHubs(auth: Auth, query = ''): Promise<PageBody> {
  const res = await testApp.request.get(`/hubs${query}`).set(auth);
  expect(res.status).toBe(200);
  return res.body as PageBody;
}

/** The fixture names of a page's items, sorted. */
function namesOf(m: Matrix, body: PageBody): string[] {
  const byId = new Map(Object.entries(m.ids).map(([k, v]) => [v, k]));
  return body.items.map((e) => byId.get(e.id) ?? `?${e.id}`).sort();
}

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
    if (!wasActive[p] && registry().isActive(p)) await registry().deactivate(p);
    if (wasActive[p] && !registry().isActive(p)) await registry().activate(p);
  }
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GET /hubs — kind × visibility × viewer (D8)', () => {
  it.each([
    ['u1', ['C1', 'S1', 'W1']],
    ['u2', ['C1', 'S1']],
    ['admin', ['C1', 'S1', 'W1', 'W2']],
  ] as const)('%s sees %j and every live kind', async (who, expected) => {
    const m = await seedMatrix();
    const body = await getHubs(m[who]);
    expect(namesOf(m, body)).toEqual(expected);
    expect(body.total).toBe(expected.length);
    expect(body.kinds).toEqual(ALL_KINDS);
  });
});

describe('GET /hubs — membership filter (D9)', () => {
  it.each([
    ['u1', 'joined', ['C1', 'S1', 'W1']],
    ['u1', 'not-joined', []],
    ['u2', 'joined', []],
    ['u2', 'not-joined', ['C1', 'S1']],
  ] as const)('%s ?membership=%s → %j', async (who, membership, expected) => {
    const m = await seedMatrix();
    const body = await getHubs(m[who], `?membership=${membership}`);
    expect(namesOf(m, body)).toEqual(expected);
  });

  it('a server sighting older than 90 days with no Join is not a membership', async () => {
    const m = await seedMatrix();
    const stale = await seedUser('dir-stale');
    await serverMember(must(m.ids.S1), stale.id, 120);
    const auth = await authOf(stale);
    const s1 = (await getHubs(auth)).items.find((e) => e.id === m.ids.S1);
    expect(s1?.viewer).toBe('not-member');
    expect(namesOf(m, await getHubs(auth, '?membership=joined'))).toEqual([]);
  });
});

describe('GET /hubs — kind filter + plugin state (D12)', () => {
  it('?kind=game_server lists S1 only; kinds still lists every live kind', async () => {
    const m = await seedMatrix();
    const body = await getHubs(m.u1, '?kind=game_server');
    expect(namesOf(m, body)).toEqual(['S1']);
    expect(body.total).toBe(1);
    expect(body.kinds).toEqual(ALL_KINDS);
  });

  it('Pelican inactive drops server hubs and the game_server kind', async () => {
    const m = await seedMatrix();
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const body = await getHubs(m.u1);
    expect(namesOf(m, body)).toEqual(['C1', 'W1']);
    expect(body.kinds).toEqual(['wow_guild', 'game_community']);
    const dead = await getHubs(m.u1, '?kind=game_server');
    expect(dead).toMatchObject({ items: [], nextCursor: null, total: 0 });
  });

  it('?kind=bogus is a 400', async () => {
    const m = await seedMatrix();
    const res = await testApp.request.get('/hubs?kind=bogus').set(m.u1);
    expect(res.status).toBe(400);
  });
});

describe('GET /hubs — entry shape (D10/D11)', () => {
  it('server rows carry kind, no leader, adapter viewer state and member_count', async () => {
    const m = await seedMatrix();
    const s1For = async (auth: Auth) =>
      (await getHubs(auth)).items.find((e) => e.id === m.ids.S1);
    expect(await s1For(m.u1)).toMatchObject({
      kind: 'game_server',
      leaderName: null,
      viewer: 'member',
      memberCount: 7,
    });
    expect((await s1For(m.u2))?.viewer).toBe('not-member');
    const c1 = (await getHubs(m.u1)).items.find((e) => e.id === m.ids.C1);
    expect(c1).toMatchObject({ kind: 'game_community', viewer: 'member' });
  });
});

describe('GET /hubs — paging over mixed kinds', () => {
  it.each(['members', 'name', 'newest'])(
    'sort=%s walks every row exactly once with a constant total',
    async (sort) => {
      const m = await seedMatrix();
      m.ids.C5 = await seedHub('C5 Crew', {
        kind: 'game_community',
        members: 7,
      });
      m.ids.S3 = await seedHub('S3 Server', {
        kind: 'game_server',
        members: 3,
      });
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const after: string = cursor === null ? '' : `&cursor=${cursor}`;
        const body = await getHubs(m.admin, `?sort=${sort}&limit=2${after}`);
        expect(body.total).toBe(6);
        seen.push(...body.items.map((e) => e.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(cursor).toBeNull();
      expect([...seen].sort((a, b) => a - b)).toEqual(
        ['C1', 'C5', 'S1', 'S3', 'W1', 'W2']
          .map((k) => must(m.ids[k]))
          .sort((a, b) => a - b),
      );
    },
  );
});

describe('GET /hubs/by-game/:gameId stays community-only (D13)', () => {
  it('lists C1 with kind game_community and no server / WoW hubs', async () => {
    const m = await seedMatrix();
    const res = await testApp.request
      .get(`/hubs/by-game/${testApp.seed.game.id}`)
      .set(m.admin);
    expect(res.status).toBe(200);
    const hubs = (res.body as { hubs: Entry[] }).hubs;
    expect(hubs.map((h) => h.id)).toEqual([m.ids.C1]);
    expect(hubs[0]?.kind).toBe('game_community');
  });
});

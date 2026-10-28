/**
 * ROK-1957 L8b2 — the hub-scoped BG3 read routes against a real DB (§5.6,
 * §9.2): the D-15 access matrix on every route, cross-hub 404s, the D-7
 * snapshot host-twin / empty / corrupt-row rules, D-8 session clustering +
 * paging. Thumbnails, the spoiler toggle, settings PUT, `me/saves`
 * and the gallery feed live in `bg3-read-media.integration.spec.ts`.
 * Saves are inserted directly (the ingest path has its own spec).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  Bg3HubCampaignsResponseSchema,
  Bg3SaveMessageSchema,
  Bg3SessionsResponseSchema,
  Bg3SnapshotResponseSchema,
  type Bg3PartyMember,
  type Bg3Snapshot,
  type UserRole,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../guilds/hub-hidden.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const PARTY: Bg3PartyMember[] = Bg3SaveMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../packages/contract/companion/bg3-save/v1/fixtures/act2-party-4p-summon.json',
      ),
      'utf8',
    ),
  ) as unknown,
).payload.party;
const KEY = 'a'.repeat(64);
const HOUR = 3_600_000;
const NOT_ACTIVE = `Plugin "${BG3_PLUGIN_ID}" is not active`;

interface Who {
  id: number;
  token: string;
}
let testApp: TestApp;
let host: Who; // member, campaign host
let guest: Who; // member, not host
let officer: Who; // hub editor
let outsider: Who; // signed in, not a member
let admin: Who; // staff, not a member
let hub: number;
let otherHub: number; // a second BG3 hub
let plainHub: number; // a community hub of another game
let camp: number;
let foreignCamp: number; // belongs to otherHub

const auth = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
const base = (h: number) => `/plugins/bg3/hubs/${h}`;

async function makeUser(name: string, role: UserRole = 'member') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const claims = { sub: u.id, username: name, role };
  return { id: u.id, token: await signTestAccessToken(testApp, claims) };
}

async function makeGame(slug: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return g.id;
}

async function makeHub(gameId: number, name: string): Promise<number> {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    `hub ${name}`,
  );
  return h.id;
}

async function join(
  guildId: number,
  userId: number,
  role: 'member' | 'officer' = 'member',
) {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role });
}

async function makeCampaign(guildId: number, hostUserId: number | null) {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Campaigns)
      .values({ guildId, name: `Campaign ${guildId}`, hostUserId })
      .returning({ id: schema.bg3Campaigns.id }),
    'campaign',
  );
  return c.id;
}

interface SaveOpts {
  uploader: number;
  campaignId: number | null;
  savedAt: string;
  area?: string;
  level?: number;
  first?: string;
  count?: number;
}

async function save(o: SaveOpts): Promise<number> {
  const at = new Date(o.savedAt);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.bg3Saves)
      .values({
        uploaderUserId: o.uploader,
        campaignId: o.campaignId,
        campaignKey: KEY,
        campaignKeySource: 'save-folder',
        saveName: `Save ${o.savedAt}`,
        savedAt: at,
        capturedAt: at,
        gameVersion: '4.1.1.7631656',
        platform: 'Steam',
        currentLevel: o.area ?? 'SCL_Main_A',
        difficulty: 'DifficultyHard',
        ruleset: 'RulesetLarian',
        party: PARTY,
        partyMaxLevel: o.level ?? 8,
        sessionFirstSavedAt: o.first ? new Date(o.first) : null,
        sessionSaveCount: o.count ?? null,
      })
      .returning({ id: schema.bg3Saves.id }),
    'save',
  );
  return row.id;
}

/** `[status, message]` of an error response. */
const said = (res: { status: number; body: unknown }): [number, unknown] => [
  res.status,
  (res.body as { message?: unknown }).message,
];

async function get(url: string, who?: Who) {
  const req = testApp.request.get(url);
  return who ? req.set(auth(who)) : req;
}

const putSettings = (h: number, who: Who | undefined, body: object) => {
  const req = testApp.request.put(`${base(h)}/settings`).send(body);
  return who ? req.set(auth(who)) : req;
};

/** Every route in scope, as `(who) => response` for hub `h`. */
function routes(h: number) {
  const b = base(h);
  return {
    campaigns: (w?: Who) => get(`${b}/campaigns`, w),
    snapshot: (w?: Who) => get(`${b}/snapshot?campaignId=${camp}`, w),
    sessions: (w?: Who) => get(`${b}/campaigns/${camp}/sessions`, w),
    thumbnail: (w?: Who) => get(`${b}/saves/1/thumbnail`, w),
    settings: (w?: Who) =>
      putSettings(h, w, { hideLocationAndScreenshots: false }),
  };
}

/** `{route: [status, message]}` for each route — one table per assertion. */
async function matrix(h: number, who?: Who) {
  const out: Record<string, [number, unknown]> = {};
  for (const [name, call] of Object.entries(routes(h))) {
    const res = await call(who);
    out[name] = said(res);
  }
  return out;
}

function same<T>(value: T): Record<string, T> {
  const keys = ['campaigns', 'snapshot', 'sessions', 'thumbnail', 'settings'];
  return Object.fromEntries(keys.map((k) => [k, value]));
}

async function snapshotOf(who: Who, campaignId = camp): Promise<Bg3Snapshot> {
  const res = await get(`${base(hub)}/snapshot?campaignId=${campaignId}`, who);
  expect(res.status).toBe(200);
  const body = Bg3SnapshotResponseSchema.parse(res.body);
  if (body.empty) throw new Error('expected a non-empty snapshot');
  return body;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(BG3_PLUGIN_ID);
  await plugins.activate(BG3_PLUGIN_ID);
  const bg3 = await makeGame(BG3_GAME_SLUG);
  hub = await makeHub(bg3, 'Tav Crew');
  otherHub = await makeHub(bg3, 'Other Crew');
  plainHub = await makeHub(await makeGame('not-bg3'), 'Plain Crew');
  host = await makeUser('host');
  guest = await makeUser('guest');
  officer = await makeUser('officer');
  outsider = await makeUser('outsider');
  admin = await makeUser('staff', 'admin');
  for (const u of [host, guest]) await join(hub, u.id);
  await join(hub, officer.id, 'officer');
  for (const u of [host, guest]) await join(plainHub, u.id);
  await join(otherHub, host.id);
  camp = await makeCampaign(hub, host.id);
  foreignCamp = await makeCampaign(otherHub, host.id);
});

describe('BG3 hub routes — access matrix (D-15)', () => {
  it('401 on every route, me/saves included, without a token', async () => {
    expect(await matrix(hub)).toEqual(same([401, 'Unauthorized']));
    expect((await get('/plugins/bg3/me/saves')).status).toBe(401);
  });

  it('403 on every route while the bg3 plugin is inactive', async () => {
    await testApp.app.get(PluginRegistryService).deactivate(BG3_PLUGIN_ID);
    expect(await matrix(hub, host)).toEqual(same([403, NOT_ACTIVE]));
    const me = await get('/plugins/bg3/me/saves', host);
    expect(said(me)).toEqual([403, NOT_ACTIVE]);
  });

  it('404 Guild not found on a community hub of another game, for its members', async () => {
    expect(await matrix(plainHub, host)).toEqual(same([404, HUB_NOT_FOUND]));
  });

  it('404 Guild not found on a hidden hub for a member; staff still read it', async () => {
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hub));
    expect(await matrix(hub, host)).toEqual(same([404, HUB_NOT_FOUND]));
    const r = routes(hub);
    const staff = await Promise.all([
      r.campaigns(admin),
      r.sessions(admin),
      r.settings(admin),
    ]);
    expect(staff.map((x) => x.status)).toEqual([200, 200, 200]);
  });

  it('403 Hub members only for a signed-in non-member', async () => {
    expect(await matrix(hub, outsider)).toEqual(
      same([403, 'Hub members only']),
    );
  });

  it('staff pass without membership; member reads; only editors canEdit', async () => {
    const r = routes(hub);
    await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T12:00:00Z',
    });
    const [a, s, ses] = await Promise.all([
      r.campaigns(admin),
      r.snapshot(admin),
      r.sessions(admin),
    ]);
    expect([a.status, s.status, ses.status]).toEqual([200, 200, 200]);
    const canEdit = async (w: Who) =>
      Bg3HubCampaignsResponseSchema.parse((await r.campaigns(w)).body).canEdit;
    expect({
      admin: await canEdit(admin),
      officer: await canEdit(officer),
      member: await canEdit(guest),
    }).toEqual({ admin: true, officer: true, member: false });
  });
});

describe('BG3 hub routes — no cross-hub read', () => {
  it("404 on another hub's campaign for snapshot and sessions", async () => {
    await save({
      uploader: host.id,
      campaignId: foreignCamp,
      savedAt: '2026-10-24T12:00:00Z',
    });
    const snap = await get(
      `${base(hub)}/snapshot?campaignId=${foreignCamp}`,
      host,
    );
    const ses = await get(
      `${base(hub)}/campaigns/${foreignCamp}/sessions`,
      host,
    );
    expect([said(snap), said(ses)]).toEqual([
      [404, 'Campaign not found'],
      [404, 'Campaign not found'],
    ]);
  });
});

describe('GET snapshot (D-3 / D-7)', () => {
  it("prefers the host's twin over a lower-id guest twin", async () => {
    const at = '2026-10-24T12:00:00Z';
    const guestTwin = await save({
      uploader: guest.id,
      campaignId: camp,
      savedAt: at,
    });
    const hostTwin = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: at,
    });
    expect(guestTwin).toBeLessThan(hostTwin);
    const snap = await snapshotOf(guest);
    expect({ saveId: snap.saveId, uploader: snap.uploaderUserId }).toEqual({
      saveId: hostTwin,
      uploader: host.id,
    });
  });

  it('a campaign with no saves → { empty: true }', async () => {
    const res = await get(`${base(hub)}/snapshot?campaignId=${camp}`, host);
    expect([res.status, res.body]).toEqual([
      200,
      { empty: true, campaignId: camp },
    ]);
  });

  it('skips a newest row whose stored party fails re-parse', async () => {
    const older = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T10:00:00Z',
    });
    const corrupt = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T12:00:00Z',
    });
    await testApp.db.execute(
      sql`UPDATE bg3_saves SET party = '[{"bogus":1}]'::jsonb WHERE id = ${corrupt}`,
    );
    expect((await snapshotOf(host)).saveId).toBe(older);
  });
});

describe('GET campaigns/:campaignId/sessions (D-8)', () => {
  /** Oldest → newest: collapsed E; A,B; C at exactly B+4 h; D at C+4 h−1 ms. */
  async function seedSessions() {
    const e = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-20T12:00:00.000Z',
      first: '2026-10-20T08:00:00.000Z',
      count: 7,
      level: 4,
    });
    const a = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T10:00:00.000Z',
      level: 5,
    });
    const b = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T11:00:00.000Z',
      level: 6,
    });
    const c = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: '2026-10-24T15:00:00.000Z',
      area: 'SCL_Main_A',
    });
    const dAt = new Date(Date.parse('2026-10-24T15:00:00.000Z') + 4 * HOUR - 1);
    const d = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: dAt.toISOString(),
      area: 'BGO_Main_A',
    });
    return { a, b, c, d, e, dAt };
  }

  const url = (q = '') => `${base(hub)}/campaigns/${camp}/sessions${q}`;

  it('splits at exactly 4 h, keeps 4 h − 1 ms together, expands a collapsed row', async () => {
    const ids = await seedSessions();
    const res = await get(url(), guest);
    expect(res.status).toBe(200);
    const body = Bg3SessionsResponseSchema.parse(res.body);
    expect(
      body.sessions.map((s) => ({
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        saveCount: s.saveCount,
        levels: [s.partyLevelFrom, s.partyLevelTo],
        areas: s.areas,
        lastSaveId: s.lastSaveId,
      })),
    ).toEqual([
      {
        startedAt: '2026-10-24T15:00:00.000Z',
        endedAt: ids.dAt.toISOString(),
        saveCount: 2,
        levels: [8, 8],
        areas: ['SCL_Main_A', 'BGO_Main_A'],
        lastSaveId: ids.d,
      },
      {
        startedAt: '2026-10-24T10:00:00.000Z',
        endedAt: '2026-10-24T11:00:00.000Z',
        saveCount: 2,
        levels: [5, 6],
        areas: ['SCL_Main_A'],
        lastSaveId: ids.b,
      },
      {
        startedAt: '2026-10-20T08:00:00.000Z',
        endedAt: '2026-10-20T12:00:00.000Z',
        saveCount: 7,
        levels: [4, 4],
        areas: ['SCL_Main_A'],
        lastSaveId: ids.e,
      },
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it('a guest twin of a host save is not counted twice', async () => {
    const at = '2026-10-24T10:00:00.000Z';
    await save({ uploader: guest.id, campaignId: camp, savedAt: at });
    const hostTwin = await save({
      uploader: host.id,
      campaignId: camp,
      savedAt: at,
    });
    const body = Bg3SessionsResponseSchema.parse((await get(url(), host)).body);
    expect(body.sessions.map((s) => [s.saveCount, s.lastSaveId])).toEqual([
      [1, hostTwin],
    ]);
  });

  it('cursor-pages one session at a time to exhaustion', async () => {
    const ids = await seedSessions();
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const q: string = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : '?limit=1';
      const res = await get(url(q), host);
      expect(res.status).toBe(200);
      const body = Bg3SessionsResponseSchema.parse(res.body);
      seen.push(...body.sessions.map((s) => s.lastSaveId));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect({ seen, cursor }).toEqual({
      seen: [ids.d, ids.b, ids.e],
      cursor: null,
    });
  });

  it('limit 20 is accepted, 21 → 400 Invalid limit', async () => {
    const ok = await get(url('?limit=20'), host);
    const bad = await get(url('?limit=21'), host);
    expect([ok.status, said(bad)]).toEqual([200, [400, 'Invalid limit']]);
  });
});

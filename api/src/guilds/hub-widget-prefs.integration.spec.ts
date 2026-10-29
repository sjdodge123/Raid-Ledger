/**
 * ROK-1918 L3 — `PATCH /guilds/:id/widget-prefs` (hub arrange mode) against a
 * real database: the auth matrix (jwt → HubVisibleGuard → GuildEditorGuard),
 * the 400 body (`zod.flatten()`), the round trip through both page reads
 * (`guilds/:id` and the `plugins/wow/guilds/:id` alias), Reset storing SQL
 * NULL, the no-profile-row upsert, the counts-only audit row and a corrupt
 * stored blob reading back as null, and a missing hub id answering 404
 * (Codex P2 — once an FK 500). Fleet-only (needs the integration
 * Postgres). Every case builds its own hubs with unique names; no truncate.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { HubWidgetPrefsInput } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { insertCommunityHub } from './community/community-proposals.queries';
import { refreshMemberCount } from './community/community-membership.queries';

const SNAP = new Date('2026-10-20T20:00:00.000Z');
const ACTION = 'hub_widget_layout_updated';

interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let admin: Who;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(role: 'member' | 'operator' = 'member'): Promise<Who> {
  const username = next('hwp');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username, discordId: `local:${username}`, role })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username,
    role,
  });
  return { id: user.id, token };
}

async function mkWowHub(hiddenAt: Date | null = null): Promise<number> {
  const name = next('Arrange Hub');
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
        hiddenAt,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

/** A user whose character GUID is on the WoW hub's live roster at `rankIndex`. */
async function mkWowMember(
  guildId: number,
  rankIndex: number,
): Promise<Who & { memberId: number }> {
  const who = await mkUser();
  const guid = `Player-1-${next('hwp')}`;
  await testApp.db.insert(schema.characters).values({
    userId: who.id,
    gameId: testApp.seed.game.id,
    name: guid.slice(-12),
    addonGuid: guid,
    region: 'us',
  });
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: guid.slice(-12),
        rankIndex,
        rankName: `Rank ${rankIndex}`,
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'guild member',
  );
  return { ...who, memberId: row.id };
}

/**
 * A WoW hub with an editor (explicit member grant) and a plain member. A WoW
 * officer IS that grant — a rank grant confers nothing (ROK-1794 AC1) — so the
 * ladder Officer rung is exercised on the community hub below.
 */
async function mkStaffedWowHub(hiddenAt: Date | null = null) {
  const guildId = await mkWowHub(hiddenAt);
  const editor = await mkWowMember(guildId, 4);
  const member = await mkWowMember(guildId, 4);
  await testApp.db
    .insert(schema.guildEditors)
    .values([{ guildId, kind: 'member', guildMemberId: editor.memberId }]);
  return { guildId, editor, member };
}

/** An active community hub with a leader, an officer and a member. */
async function mkCommunityHub() {
  const [leader, officer, member] = [
    await mkUser(),
    await mkUser(),
    await mkUser(),
  ];
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: next('Arrange Community'),
    blurb: 'Arrange hub',
    status: 'active',
    proposedBy: leader.id,
    reviewedBy: null,
  });
  await testApp.db.insert(schema.hubCommunityMembers).values([
    { guildId: hub.id, userId: leader.id, role: 'leader' as const },
    { guildId: hub.id, userId: officer.id, role: 'officer' as const },
    { guildId: hub.id, userId: member.id, role: 'member' as const },
  ]);
  await refreshMemberCount(testApp.db, hub.id);
  return { guildId: hub.id, leader, officer, member };
}

const LAYOUT: HubWidgetPrefsInput = {
  order: ['core:discord', 'core:gm-post'],
  hidden: ['core:links'],
  added: ['generic:text'],
  config: { 'generic:text': { title: 'Raid night', body: 'Bring flasks' } },
};

function patch(guildId: number, token: string | null, body: unknown) {
  const r = testApp.request.patch(`/guilds/${guildId}/widget-prefs`);
  return (token === null ? r : r.set('Authorization', `Bearer ${token}`)).send(
    body as object,
  );
}

const page = (path: string) =>
  testApp.request.get(path).set('Authorization', `Bearer ${admin.token}`);

/** Raw column state: SQL NULL vs a stored jsonb value (incl. JSON `null`). */
async function storedColumn(guildId: number) {
  const rows = await testApp.db.execute<{
    sql_null: boolean;
    json_type: string | null;
  }>(
    sql`SELECT widget_prefs IS NULL AS sql_null, jsonb_typeof(widget_prefs) AS json_type
        FROM guild_profiles WHERE guild_id = ${guildId}`,
  );
  return [...rows];
}

function auditRows(guildId: number) {
  const a = schema.activityLog;
  return testApp.db
    .select({ actorId: a.actorId, metadata: a.metadata })
    .from(a)
    .where(
      and(
        eq(a.entityType, 'hub'),
        eq(a.entityId, guildId),
        eq(a.action, ACTION),
      ),
    )
    .orderBy(a.id);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  admin = {
    id: testApp.seed.adminUser.id,
    token: await loginAsAdmin(testApp.request, testApp.seed),
  };
});

describe('auth matrix', () => {
  it('WoW hub: editor, operator + admin non-members → 200; member → 403', async () => {
    const hub = await mkStaffedWowHub();
    const operator = await mkUser('operator');
    for (const who of [hub.editor, operator, admin]) {
      const res = await patch(hub.guildId, who.token, LAYOUT);
      expect({ id: who.id, status: res.status }).toEqual({
        id: who.id,
        status: 200,
      });
    }
    const refused = await patch(hub.guildId, hub.member.token, LAYOUT);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('Guild editor access required');
  });

  it('community hub: leader + officer → 200; member + signed-in visitor → 403', async () => {
    const hub = await mkCommunityHub();
    const visitor = await mkUser();
    expect((await patch(hub.guildId, hub.leader.token, LAYOUT)).status).toBe(
      200,
    );
    expect((await patch(hub.guildId, hub.officer.token, LAYOUT)).status).toBe(
      200,
    );
    expect((await patch(hub.guildId, hub.member.token, LAYOUT)).status).toBe(
      403,
    );
    expect((await patch(hub.guildId, visitor.token, LAYOUT)).status).toBe(403);
  });

  it('anonymous → 401 and nothing is stored', async () => {
    const guildId = await mkWowHub();
    expect((await patch(guildId, null, LAYOUT)).status).toBe(401);
    expect(await storedColumn(guildId)).toEqual([]);
  });

  it('hidden hub: its editor gets HubVisibleGuard 404; admin still saves', async () => {
    const hub = await mkStaffedWowHub(new Date());
    const hidden = await patch(hub.guildId, hub.editor.token, LAYOUT);
    expect(hidden.status).toBe(404);
    expect(hidden.body.message).toBe('Guild not found');
    expect((await patch(hub.guildId, admin.token, LAYOUT)).status).toBe(200);
  });
});

describe('400 on a bad body (zod.flatten)', () => {
  const longIds = Array.from({ length: 64 }, (_, i) =>
    `w${i}`.padEnd(120, 'x'),
  );
  const cases: [string, unknown, unknown][] = [
    [
      'duplicate ids',
      { order: ['a', 'a'], hidden: [], added: [] },
      { formErrors: [], fieldErrors: { order: ['Duplicate widget id'] } },
    ],
    [
      'more than 64 ids',
      {
        order: Array.from({ length: 65 }, (_, i) => `w${i}`),
        hidden: [],
        added: [],
      },
      {
        formErrors: [],
        fieldErrors: { order: [expect.stringContaining('64')] },
      },
    ],
    [
      'config on a widget other than generic:text',
      { order: [], hidden: [], added: [], config: { 'generic:countdown': {} } },
      {
        formErrors: [],
        fieldErrors: { config: ['Widget does not accept settings'] },
      },
    ],
    [
      // Codex P2: an inherited-prop key once threw in the schema → 500.
      'config keyed by an inherited prop (constructor)',
      { order: [], hidden: [], added: [], config: { constructor: {} } },
      {
        formErrors: [],
        fieldErrors: { config: ['Widget does not accept settings'] },
      },
    ],
    [
      'an oversize layout',
      { order: longIds, hidden: longIds, added: longIds },
      {
        formErrors: ['Layout is larger than 16384 characters'],
        fieldErrors: {},
      },
    ],
  ];

  it.each(cases)('%s → 400, nothing stored, no audit', async (_, body, err) => {
    const guildId = await mkWowHub();
    const res = await patch(guildId, admin.token, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(err);
    expect(await storedColumn(guildId)).toEqual([]);
    expect(await auditRows(guildId)).toEqual([]);
  });
});

describe('round trip, reset, upsert', () => {
  const saved = LAYOUT;

  it('a hub with no profile row upserts it; both page reads return the layout', async () => {
    const guildId = await mkWowHub();
    expect(await storedColumn(guildId)).toEqual([]);
    const res = await patch(guildId, admin.token, LAYOUT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ widgetPrefs: saved });
    expect(await storedColumn(guildId)).toEqual([
      { sql_null: false, json_type: 'object' },
    ]);
    for (const path of [
      `/guilds/${guildId}`,
      `/plugins/wow/guilds/${guildId}`,
    ]) {
      const got = await page(path);
      expect({ path, status: got.status }).toEqual({ path, status: 200 });
      expect(got.body.widgetPrefs).toEqual(saved);
    }
  });

  it('ROK-1969 I4: a legacy Gallery id is stored as plugin:core:gallery', async () => {
    const guildId = await mkWowHub();
    const legacy = 'plugin:valheim:gallery';
    const res = await patch(guildId, admin.token, {
      order: [legacy, 'core:gm-post'],
      hidden: [legacy],
      added: [],
    });
    const want = {
      order: ['plugin:core:gallery', 'core:gm-post'],
      hidden: ['plugin:core:gallery'],
      added: [],
      config: {},
    };
    expect(res.body).toEqual({ widgetPrefs: want });
    expect((await page(`/guilds/${guildId}`)).body.widgetPrefs).toEqual(want);
  });

  it('omitted config is stored and returned as {}', async () => {
    const guildId = await mkWowHub();
    const body = { order: ['core:gm-post'], hidden: [], added: [] };
    const res = await patch(guildId, admin.token, body);
    expect(res.body).toEqual({ widgetPrefs: { ...body, config: {} } });
    expect((await page(`/guilds/${guildId}`)).body.widgetPrefs).toEqual({
      ...body,
      config: {},
    });
  });

  it('reset stores SQL NULL (not JSON null), returns null, page reads null', async () => {
    const guildId = await mkWowHub();
    await patch(guildId, admin.token, LAYOUT);
    const res = await patch(guildId, admin.token, { reset: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ widgetPrefs: null });
    expect(await storedColumn(guildId)).toEqual([
      { sql_null: true, json_type: null },
    ]);
    expect((await page(`/guilds/${guildId}`)).body.widgetPrefs).toBeNull();
  });
});

describe('a missing hub', () => {
  it.each([
    ['a layout save', LAYOUT],
    ['a reset', { reset: true }],
  ])(
    'admin %s on a non-existent hub id → 404, not an FK 500; nothing written',
    async (_, body) => {
      const rows = await testApp.db.execute<{ id: number }>(
        sql`SELECT (COALESCE(MAX(id), 0) + 100000)::int AS id FROM guilds`,
      );
      const [missing] = nonEmpty([...rows], 'missing id');
      const res = await patch(missing.id, admin.token, body);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Guild not found');
      expect(await storedColumn(missing.id)).toEqual([]);
      expect(await auditRows(missing.id)).toEqual([]);
    },
  );
});

describe('audit', () => {
  it('writes a counts-only audit row per save with the acting editor', async () => {
    const hub = await mkStaffedWowHub();
    await patch(hub.guildId, hub.editor.token, LAYOUT);
    await patch(hub.guildId, admin.token, { reset: true });
    await patch(hub.guildId, hub.member.token, LAYOUT); // 403 — no row
    const rows = await auditRows(hub.guildId);
    expect(rows).toEqual([
      {
        actorId: hub.editor.id,
        metadata: {
          reset: false,
          order: 2,
          hidden: 1,
          added: 1,
          configured: 1,
        },
      },
      { actorId: admin.id, metadata: { reset: true } },
    ]);
    const text = JSON.stringify(rows);
    for (const leak of ['generic:text', 'core:', 'Raid night', 'flasks']) {
      expect({ leak, found: text.includes(leak) }).toEqual({
        leak,
        found: false,
      });
    }
  });
});

describe('a corrupt stored layout', () => {
  it.each([
    ['a shape the schema rejects', `'{"order":"nope","hidden":[]}'::jsonb`],
    ['JSON null', `'null'::jsonb`],
  ])('%s reads back as null without a 500', async (_, literal) => {
    const guildId = await mkWowHub();
    await patch(guildId, admin.token, LAYOUT);
    await testApp.db.execute(
      sql`UPDATE guild_profiles SET widget_prefs = ${sql.raw(literal)} WHERE guild_id = ${guildId}`,
    );
    for (const path of [
      `/guilds/${guildId}`,
      `/plugins/wow/guilds/${guildId}`,
    ]) {
      const got = await page(path);
      expect({ path, status: got.status }).toEqual({ path, status: 200 });
      expect(got.body.widgetPrefs).toBeNull();
    }
  });
});

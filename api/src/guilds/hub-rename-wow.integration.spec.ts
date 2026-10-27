/**
 * ROK-2015 A3 — renaming a WoW guild hub end to end against a real database:
 * `PATCH /guilds/:id/name` plus the real LedgerLink import (A3-1…A3-6) and
 * the `GET /hubs` directory by shown name (A3-7). Fleet-only. The import
 * harness mirrors A1's `addon-import-guild-rename.integration.spec.ts`.
 * A3-8: this file replaces the old WoW case 15 of `hub-rename.integration`.
 *
 * Mutations (for the Lead): drop `inGameName` from `kindNameFields` → A3-1
 * red; drop the `CASE WHEN name_overridden` in `guildConflictSet` → A3-1's
 * post-import name reads 'Night Shift'; sort the directory by `name_key`
 * again → A3-7 lists Zeta Lads first; drop the `byShown` arm → `q=lads` empty.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { and, eq, isNull } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import {
  FIXTURE_GUID,
  buildGuildPayload,
  buildImportString,
} from '../plugins/wow-common/addon-import/testing/addon-fixture.builder';
import { grantMemberEditor } from '../plugins/wow-common/addon-import/testing/grant-member-editor';
import { pinExportClock } from '../plugins/wow-common/addon-import/testing/pin-export-clock';
import { insertCommunityHub } from './community/community-proposals.queries';
import { RENAME_ERRORS } from './hub-rename.helpers';

pinExportClock();

const FIXTURES = join(
  __dirname,
  '../../../packages/contract/ledgerlink/v1/fixtures',
);
const IN_GAME = 'Night Shift';
const KEY = 'night shift';
const CUSTOM = 'The Iron Lads';
const PLUGINS = ['blizzard', PELICAN_PLUGIN_ID];

let testApp: TestApp;
let gameId: number;
let adminToken: string;
const g = schema.guilds;
const registry = () => testApp.app.get(PluginRegistryService);

async function ensureForever(): Promise<number> {
  const slug = 'world-of-warcraft-forever';
  const [hit] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (hit) return hit.id;
  const name = 'World of Warcraft: Forever';
  const [game] = nonEmpty(
    await testApp.db.insert(schema.games).values({ name, slug }).returning(),
    'forever game',
  );
  return game.id;
}

/** A member signed in through `/auth/local` (the import's own login path). */
async function memberToken(username: string): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

interface Importer {
  token: string;
  charId: string;
}

/** Import `importString` as `who`'s character (200 asserted). */
async function importAs(who: Importer, importString: string): Promise<void> {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${who.charId}/addon-import`)
    .set('Authorization', `Bearer ${who.token}`)
    .send({ importString, dryRun: false });
  expect(res.status).toBe(200);
}

/** The golden roster under `name`, `step` minutes after the export. */
function snapshot(step: number, name: string = IN_GAME): string {
  const raw = readFileSync(join(FIXTURES, 'guild-1-page.json'), 'utf8');
  const fx = JSON.parse(raw) as {
    payload: { data: { members: AddonGuildMember[] } };
  };
  const payload = buildGuildPayload(fx.payload.data.members);
  payload.data.name = name;
  payload.who.guildName = name;
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

/** The FIXTURE_GUID member imports "Night Shift" and is made an editor. */
async function seedImported(): Promise<Importer> {
  const token = await memberToken(`gm${Date.now() % 100000}`);
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(res.status).toBe(201);
  const who = { token, charId: res.body.id as string };
  await importAs(who, snapshot(0));
  await grantMemberEditor(testApp.db, FIXTURE_GUID);
  return who;
}

/** A WoW row inserted directly (no import). */
async function mkWow(
  name: string,
  extra: Partial<typeof g.$inferInsert> = {},
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(g)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        sourceName: name,
        source: 'addon_import',
        ...extra,
      })
      .returning({ id: g.id }),
    `wow ${name}`,
  );
  return row.id;
}

const rename = (id: number, body: object, token: string = adminToken) =>
  testApp.request
    .patch(`/guilds/${id}/name`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

/** Every WoW row of the Forever game holding the in-game key. */
const keyRows = () =>
  testApp.db
    .select()
    .from(g)
    .where(
      and(eq(g.gameId, gameId), eq(g.kind, 'wow_guild'), eq(g.nameKey, KEY)),
    )
    .orderBy(g.id);

async function realmless(): Promise<typeof g.$inferSelect> {
  const rows = await testApp.db
    .select()
    .from(g)
    .where(and(eq(g.nameKey, KEY), isNull(g.realmSlug)));
  return nonEmpty(rows, 'realm-less guild')[0];
}

async function rowOf(id: number): Promise<typeof g.$inferSelect> {
  const rows = await testApp.db.select().from(g).where(eq(g.id, id));
  return nonEmpty(rows, `guild ${id}`)[0];
}

async function renameAudits(id: number): Promise<unknown[]> {
  const a = schema.activityLog;
  const rows = await testApp.db
    .select({ metadata: a.metadata })
    .from(a)
    .where(
      and(
        eq(a.entityType, 'hub'),
        eq(a.entityId, id),
        eq(a.action, 'hub_renamed'),
      ),
    );
  return rows.map((r) => r.metadata);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureForever();
  for (const p of PLUGINS) {
    await registry().ensureInstalled(p);
    if (!registry().isActive(p)) await registry().activate(p);
  }
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  // Pelican only: deactivate('blizzard') drops the Forever identity provider
  // and only activate() restores it, but after the truncate beforeEach's
  // ensureInstalled re-inserts the row already active (activate() no-ops), so
  // every later character create 400s "Region and ruleset do not apply".
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2015 — rename a WoW guild, then import it again', () => {
  it('A3-1: the custom name sticks; name_key stays in-game; one audit row', async () => {
    const who = await seedImported();
    const { id } = await realmless();
    const res = await rename(id, { name: CUSTOM });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: CUSTOM,
      nameOverridden: true,
      inGameName: IN_GAME,
    });
    await importAs(who, snapshot(5));
    const rows = await keyRows();
    expect(rows.map((r) => [r.id, r.name, r.nameKey, r.sourceName])).toEqual([
      [id, CUSTOM, KEY, IN_GAME],
    ]);
    expect(await renameAudits(id)).toEqual([
      expect.objectContaining({ kind: 'wow_guild', reset: false }),
    ]);
  });

  it('A3-2: a reset restores the in-game name, which the import owns again', async () => {
    const who = await seedImported();
    const { id } = await realmless();
    expect((await rename(id, { name: CUSTOM })).status).toBe(200);
    const reset = await rename(id, { name: null });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ name: IN_GAME, nameOverridden: false });
    await importAs(who, snapshot(5, 'NIGHT SHIFT'));
    const rows = await keyRows();
    expect(rows.map((r) => [r.id, r.name, r.nameOverridden])).toEqual([
      [id, 'NIGHT SHIFT', false],
    ]);
  });

  it('A3-3: the in-game GM and an officer (non-staff) get 403', async () => {
    const who = await seedImported();
    const { id } = await realmless();
    const gm = schema.guildMembers;
    for (const rankIndex of [0, 1]) {
      await testApp.db
        .update(gm)
        .set({ rankIndex })
        .where(eq(gm.guid, FIXTURE_GUID));
      const res = await rename(id, { name: CUSTOM }, who.token);
      expect([rankIndex, res.status, res.body.message]).toEqual([
        rankIndex,
        403,
        'Hub leader access required',
      ]);
    }
    expect((await rowOf(id)).name).toBe(IN_GAME);
  });
});

describe('ROK-2015 — WoW reset edge cases', () => {
  it('A3-4: renaming to exactly the in-game name is a reset', async () => {
    const id = await mkWow(CUSTOM, {
      nameKey: KEY,
      sourceName: IN_GAME,
      nameOverridden: true,
    });
    const res = await rename(id, { name: IN_GAME });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: IN_GAME, nameOverridden: false });
    expect(await renameAudits(id)).toEqual([
      expect.objectContaining({ kind: 'wow_guild', reset: true }),
    ]);
  });

  it('A3-4b: no in-game name on record → reset 409 wowNoSource; a name is 200', async () => {
    const id = await mkWow('Sourceless', { sourceName: null });
    const reset = await rename(id, { name: null });
    expect([reset.status, reset.body.message]).toEqual([
      409,
      RENAME_ERRORS.wowNoSource,
    ]);
    const named = await rename(id, { name: 'Sourceless Lads' });
    expect(named.status).toBe(200);
    expect(named.body).toMatchObject({
      nameOverridden: true,
      inGameName: null,
    });
  });
});

describe('ROK-2015 — realm-scoped and cross-kind names', () => {
  it('A3-5: a realm-scoped renamed guild is untouched by the realm-less import', async () => {
    const realmed = await mkWow(IN_GAME, {
      realmSlug: 'doomhowl',
      source: 'blizzard',
      memberCount: 7,
    });
    expect((await rename(realmed, { name: CUSTOM })).status).toBe(200);
    await seedImported();
    const rows = await keyRows();
    expect(rows).toHaveLength(2);
    const after = await rowOf(realmed);
    expect([after.name, after.nameOverridden, after.memberCount]).toEqual([
      CUSTOM,
      true,
      7,
    ]);
    expect((await realmless()).name).toBe(IN_GAME);
    const reset = await rename(realmed, { name: null });
    expect(reset.body).toMatchObject({ name: IN_GAME, nameOverridden: false });
  });

  it('A3-6: a community hub of the same name on the game does not block it (D8)', async () => {
    await insertCommunityHub(testApp.db, {
      gameId,
      name: CUSTOM,
      blurb: 'Same name',
      status: 'active',
      proposedBy: testApp.seed.adminUser.id,
      reviewedBy: testApp.seed.adminUser.id,
    });
    const id = await mkWow(IN_GAME);
    const res = await rename(id, { name: CUSTOM });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: CUSTOM });
  });
});

interface DirPage {
  items: { id: number; name: string }[];
  nextCursor: string | null;
}

async function hubs(query: string): Promise<DirPage> {
  const res = await testApp.request
    .get(`/hubs?gameId=${gameId}&${query}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body as DirPage;
}

/** Community "Alpha", server "Mu", WoW "Aardvark" renamed "Zeta Lads". */
async function seedDirectory(): Promise<void> {
  await insertCommunityHub(testApp.db, {
    gameId,
    name: 'Alpha',
    blurb: 'Directory',
    status: 'active',
    proposedBy: testApp.seed.adminUser.id,
    reviewedBy: testApp.seed.adminUser.id,
  });
  await mkWow('Mu', { kind: 'game_server', source: 'pelican' });
  const wow = await mkWow('Aardvark', { lastSnapshotAt: new Date() });
  expect((await rename(wow, { name: 'Zeta Lads' })).status).toBe(200);
}

describe('ROK-2015 — the directory lists a renamed WoW guild by its shown name', () => {
  it('A3-7: sort=name orders by shown name, paging keeps that order', async () => {
    await seedDirectory();
    const names = (await hubs('sort=name')).items.map((e) => e.name);
    expect(names).toEqual(['Alpha', 'Mu', 'Zeta Lads']);
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const after: string =
        cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page: DirPage = await hubs(`sort=name&limit=1${after}`);
      walked.push(...page.items.map((e) => e.name));
      cursor = page.nextCursor;
    } while (cursor !== null && walked.length < 5);
    expect(walked).toEqual(['Alpha', 'Mu', 'Zeta Lads']);
  });

  it.each([['lads'], ['aardvark'], ['ZETA']])(
    'A3-7: q=%s finds the renamed WoW guild',
    async (q) => {
      await seedDirectory();
      const names = (await hubs(`q=${q}`)).items.map((e) => e.name);
      expect(names).toEqual(['Zeta Lads']);
    },
  );
});

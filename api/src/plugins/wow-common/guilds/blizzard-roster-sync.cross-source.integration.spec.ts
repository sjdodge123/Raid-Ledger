/**
 * ROK-2225 — "Large guild roster change" fired every 6 hours for a guild
 * whose Blizzard and LedgerLink rosters each hold two members the other
 * cannot pair. Each source measured churn against the other's snapshot, so
 * every alternation counted those rows as removed + added again. A source
 * must not count a row it could never see. Harness: the sibling
 * `blizzard-roster-sync.integration.spec.ts`. Fleet-only.
 */
import * as bcrypt from 'bcrypt';
import { asc, eq } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ROSTER_FLAG_TITLE } from '../addon-import/addon-import-guild.flag';
import { ROSTER_AUDIT_ACTION } from '../addon-import/addon-import-guild.guard';
import {
  FIXTURE_EXPORTED_AT,
  buildGuildPayload,
  buildImportString,
  buildMember,
} from '../addon-import/testing/addon-fixture.builder';
import { pinExportClock } from '../addon-import/testing/pin-export-clock';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import { BlizzardService } from '../blizzard.service';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
let testApp: TestApp;
let gameId: number;
let fetchSpy: jest.SpyInstance;

/** Members both sources see ("Name Surname" ↔ Blizzard "Name"). */
const PAIRED = [
  'Ana Forever',
  'Rok Androl',
  'Hip Smith',
  'Zed Quill',
  'Bo Lark',
  'Cy Moss',
];
/** LedgerLink-only: Blizzard never returns them (GUID, no Blizzard id). */
const LL_ONLY = ['Dee Solo', 'Eli Solo'];
/** Blizzard-only first names no LedgerLink row pairs with (no GUID). */
const BLIZZ_ONLY = ['Fay', 'Gus'];

const ALL_LL = [...PAIRED, ...LL_ONLY];
/** Ana is the importer (FIXTURE_GUID); every other GUID is stable per name. */
const ledgerLinkRoster = (names = ALL_LL) =>
  names.map((name) =>
    buildMember(name === 'Ana Forever' ? 0xabcdef0 : 0x100 + ALL_LL.indexOf(name), {
      name,
    }),
  );
const apiMember = (name: string, blizzardId: number): ForeverGuildMember => ({
  name,
  level: 60,
  classId: 8,
  rank: 3,
  blizzardId,
});
const blizzardRoster = (paired = PAIRED, extra = BLIZZ_ONLY) => [
  ...paired.map((n) => apiMember(n.split(' ')[0] ?? n, 900 + PAIRED.indexOf(n))),
  ...extra.map((n, i) => apiMember(n, 990 + i)),
];

async function setup(): Promise<void> {
  const [found] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  const rows = found
    ? [found]
    : await testApp.db
        .insert(schema.games)
        .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
        .returning();
  gameId = nonEmpty(rows, 'forever game')[0].id;
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
}

/** A non-staff importer whose character is on the roster. */
async function importer(): Promise<{ token: string; charId: string }> {
  const email = `gm${Date.now()}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: 'gm', role: 'member' })
      .returning(),
    'user',
  );
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId: user.id });
  const auth = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token = auth.body.access_token as string;
  const char = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(char.status).toBe(201);
  return { token, charId: char.body.id as string };
}
type Who = Awaited<ReturnType<typeof importer>>;

async function addonImport(who: Who, members: AddonGuildMember[], step = 0) {
  const payload = buildGuildPayload(members);
  payload.data.snapshotAt += step * 60;
  const res = await testApp.request
    .post(`/plugins/wow/characters/${who.charId}/addon-import`)
    .set('Authorization', `Bearer ${who.token}`)
    .send({ importString: buildImportString(payload), dryRun: false });
  expect(res.status).toBe(200);
  expect(res.body.status).not.toBe('stale');
}

async function seedGuild() {
  const who = await importer();
  await addonImport(who, ledgerLinkRoster());
  const [guild] = nonEmpty(
    await testApp.db
      .update(schema.guilds)
      .set({ guildSlug: 'night-shift' })
      .returning(),
    'guild',
  );
  return { who, guildId: guild.id };
}

/** Run one sync, then move its instant T back to seed + `secs` (exports are pinned). */
async function syncAt(guildId: number, roster: ForeverGuildMember[], secs: number) {
  fetchSpy.mockResolvedValue({ members: roster });
  const svc = testApp.app.get(BlizzardRosterSyncService);
  expect((await svc.syncForeverGuildRoster(guildId)).status).toBe('ok');
  const [g] = await testApp.db
    .select({ t: schema.guilds.lastSnapshotAt })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId));
  const t = g?.t;
  if (t === null || t === undefined) throw new Error('sync stamped no snapshot');
  const to = new Date((FIXTURE_EXPORTED_AT + secs) * 1000);
  const m = schema.guildMembers;
  await testApp.db.update(m).set({ lastSeenAt: to }).where(eq(m.lastSeenAt, t));
  await testApp.db
    .update(schema.guilds)
    .set({ lastSnapshotAt: to, blizzardRosterSyncedAt: to })
    .where(eq(schema.guilds.id, guildId));
}

/** removed/added of every roster audit after the guild-creating import. */
async function churn(): Promise<string[]> {
  const rows = await testApp.db
    .select({ meta: schema.activityLog.metadata })
    .from(schema.activityLog)
    .where(eq(schema.activityLog.action, ROSTER_AUDIT_ACTION))
    .orderBy(asc(schema.activityLog.id));
  return rows.slice(1).map((r) => {
    const m = r.meta as { removed?: number; added?: number } | null;
    return `${m?.removed ?? '?'}/${m?.added ?? '?'}`;
  });
}

const flags = () =>
  testApp.db
    .select({ payload: schema.notifications.payload })
    .from(schema.notifications)
    .where(eq(schema.notifications.title, ROSTER_FLAG_TITLE));

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await setup();
  fetchSpy = jest.spyOn(
    testApp.app.get(BlizzardService),
    'fetchForeverGuildRoster',
  );
});

afterEach(async () => {
  fetchSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2225 — Blizzard ↔ LedgerLink roster churn', () => {
  it('sync → import → sync → import with 2+2 unpaired rows counts no churn and raises no flag', async () => {
    const { who, guildId } = await seedGuild();
    await syncAt(guildId, blizzardRoster(), 60);
    await addonImport(who, ledgerLinkRoster(), 2);
    await syncAt(guildId, blizzardRoster(), 180);
    await addonImport(who, ledgerLinkRoster(), 4);
    // First sync: Fay/Gus are new to the stored roster; Dee/Eli are not "removed".
    expect(await churn()).toEqual(['0/2', '0/0', '0/0', '0/0']);
    expect(await flags()).toEqual([]);
  });

  it('a Blizzard run that loses rows it previously saw still flags', async () => {
    const { who, guildId } = await seedGuild();
    await syncAt(guildId, blizzardRoster(), 60);
    await addonImport(who, ledgerLinkRoster(), 2);
    await syncAt(guildId, blizzardRoster(PAIRED.slice(0, 2), []), 180);
    expect((await churn()).at(-1)).toBe('6/0');
    const got = await flags();
    expect(got.length).toBeGreaterThan(0);
    expect(got[0]?.payload).toMatchObject({ guildId, dropsEditor: false });
  });

  it('a LedgerLink import that drops GUID rows still flags', async () => {
    const { who, guildId } = await seedGuild();
    await syncAt(guildId, blizzardRoster(), 60);
    await addonImport(who, ledgerLinkRoster(PAIRED.slice(0, 2)), 2);
    expect((await churn()).at(-1)).toBe('6/0');
    expect((await flags()).length).toBeGreaterThan(0);
  });
});

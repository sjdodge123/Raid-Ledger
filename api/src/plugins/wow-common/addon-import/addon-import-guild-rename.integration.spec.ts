/**
 * ROK-2015 — a Raid Ledger rename of a WoW guild survives LedgerLink imports.
 * `name_key` stays the in-game key (D1), so a re-import finds the same row;
 * the conflict update keeps `name` while `name_overridden` (D2) and always
 * refreshes `source_name` (D3). The override is set directly in the DB so
 * this spec does not depend on the rename route. Harness copied from
 * `addon-import-guild-trust.integration.spec.ts` (real DB, golden fixtures).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { and, eq, isNull } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_GUID,
  buildGuildPayload,
  buildImportString,
} from './testing/addon-fixture.builder';
import { grantMemberEditor } from './testing/grant-member-editor';
import { FIXTURE_NOW_MS, pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');
const fixtureJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as T;

const IN_GAME = 'Night Shift';
const KEY = 'night shift';
const CUSTOM = 'The Night Lads';

let testApp: TestApp;
let gameId: number;

async function ensureGame(slug: string, name: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db.insert(schema.games).values({ name, slug }).returning(),
    `${slug} game`,
  );
  return game.id;
}

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

async function createChar(token: string): Promise<string> {
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
  return res.body.id as string;
}

const apply = (token: string, charId: string, importString: string) =>
  testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString, dryRun: false });

interface GuildFixture {
  payload: { data: { members: AddonGuildMember[] } };
}
const roster = () =>
  fixtureJson<GuildFixture>('guild-1-page').payload.data.members;

/** The full roster under `name`, `step` minutes after the golden export. */
function snapshot(step: number, name: string = IN_GAME): string {
  const payload = buildGuildPayload(roster());
  payload.data.name = name;
  payload.who.guildName = name;
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

/** Every WoW row of the game holding the in-game key, realm-less first. */
const keyRows = () =>
  testApp.db
    .select()
    .from(schema.guilds)
    .where(
      and(
        eq(schema.guilds.gameId, gameId),
        eq(schema.guilds.kind, 'wow_guild'),
        eq(schema.guilds.nameKey, KEY),
      ),
    )
    .orderBy(schema.guilds.id);

const realmlessRow = async () =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(
        and(eq(schema.guilds.nameKey, KEY), isNull(schema.guilds.realmSlug)),
      ),
    'realm-less guild',
  )[0];

/** A real member (FIXTURE_GUID) creates the guild and is made an editor. */
async function seedGuild(): Promise<{ token: string; charId: string }> {
  const token = await memberToken('realgm');
  const charId = await createChar(token);
  expect((await apply(token, charId, fixture('guild-1-page'))).status).toBe(
    200,
  );
  await grantMemberEditor(testApp.db, FIXTURE_GUID);
  return { token, charId };
}

/** Stand-in for the rename route (lane A2): override + a detectable count. */
async function overrideName(
  extra: Partial<typeof schema.guilds.$inferInsert>,
): Promise<void> {
  await testApp.db
    .update(schema.guilds)
    .set({ name: CUSTOM, nameOverridden: true, memberCount: 0, ...extra })
    .where(eq(schema.guilds.nameKey, KEY));
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame(FOREVER_SLUG, 'World of Warcraft: Forever');
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2015 — WoW guild rename vs LedgerLink import', () => {
  it('I3: a new guild stores source_name = name = the in-game name', async () => {
    await seedGuild();
    const rows = await keyRows();
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => [r.name, r.sourceName, r.nameOverridden])).toEqual([
      [IN_GAME, IN_GAME, false],
    ]);
  });

  it('I1: a re-import updates the same row and keeps the custom name', async () => {
    const { token, charId } = await seedGuild();
    const before = await realmlessRow();
    await overrideName({ sourceName: 'stale in-game name' });
    expect((await apply(token, charId, snapshot(5))).status).toBe(200);
    const rows = await keyRows();
    expect(rows).toHaveLength(1);
    const [row] = nonEmpty(rows, 'guild');
    expect(row.id).toBe(before.id);
    expect([row.name, row.nameOverridden, row.sourceName]).toEqual([
      CUSTOM,
      true,
      IN_GAME,
    ]);
    expect(row.memberCount).toBe(roster().length);
    expect(row.lastSnapshotAt?.getTime()).toBeGreaterThan(
      before.lastSnapshotAt?.getTime() ?? Infinity,
    );
  });

  it('I2: a non-overridden guild still follows the in-game name', async () => {
    const { token, charId } = await seedGuild();
    const recased = 'NIGHT Shift';
    expect((await apply(token, charId, snapshot(5, recased))).status).toBe(200);
    const rows = await keyRows();
    expect(rows.map((r) => [r.name, r.sourceName, r.nameOverridden])).toEqual([
      [recased, recased, false],
    ]);
  });

  it('I4: a stale snapshot writes nothing to an overridden guild', async () => {
    const { token, charId } = await seedGuild();
    await overrideName({ lastSnapshotAt: new Date(FIXTURE_NOW_MS) });
    const before = await realmlessRow();
    const res = await apply(token, charId, fixture('guild-1-page'));
    expect(res.status).toBe(200);
    expect(await realmlessRow()).toEqual(before);
  });
});

describe('ROK-2015 — realm-scoped WoW guilds', () => {
  it('a realm-scoped renamed guild is isolated from the realm-less import', async () => {
    const [realmed] = nonEmpty(
      await testApp.db
        .insert(schema.guilds)
        .values({
          gameId,
          region: 'us',
          name: CUSTOM,
          nameKey: KEY,
          sourceName: IN_GAME,
          nameOverridden: true,
          realmSlug: 'doomhowl',
          source: 'blizzard',
        })
        .returning(),
      'realm-scoped guild',
    );
    await seedGuild();
    const rows = await keyRows();
    expect(rows).toHaveLength(2);
    const after = rows.find((r) => r.id === realmed.id);
    expect(after).toEqual(realmed);
    expect((await realmlessRow()).name).toBe(IN_GAME);
  });
});

/**
 * ROK-1919 AC2 — a LedgerLink guild re-import logs level-ups ("dings") in
 * `guild_member_level_events`: only rises of existing members, one event per
 * jump, `occurred_at` = the snapshot's received instant, idempotent per
 * `(member, to_level)`, nothing for a first or stale import. Harness copied
 * from `addon-import-guild-rename.integration.spec.ts` (real DB, golden
 * fixtures).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { asc, eq } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  FIXTURE_GUID,
  buildGuildPayload,
  buildImportString,
  buildMember,
} from './testing/addon-fixture.builder';
import { grantMemberEditor } from './testing/grant-member-editor';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const DINGER = 'Player-4395-00000001';

let testApp: TestApp;
let gameId: number;

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning(),
    'forever game',
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

interface GuildFixture {
  payload: { data: { members: AddonGuildMember[] } };
}
const roster = (): AddonGuildMember[] =>
  (
    JSON.parse(
      readFileSync(join(FIXTURES, 'guild-1-page.json'), 'utf8'),
    ) as GuildFixture
  ).payload.data.members;

/** The golden roster `step` minutes after export, DINGER at `level`. */
function snapshot(
  step: number,
  level: number,
  extra: AddonGuildMember[] = [],
): string {
  const members = roster().map((m) =>
    m.guid === DINGER ? { ...m, level } : m,
  );
  const payload = buildGuildPayload([...members, ...extra]);
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

const atStep = (step: number): number =>
  (FIXTURE_EXPORTED_AT + step * 60) * 1000;

interface Importer {
  token: string;
  charId: string;
}

async function apply(who: Importer, importString: string) {
  return testApp.request
    .post(`/plugins/wow/characters/${who.charId}/addon-import`)
    .set('Authorization', `Bearer ${who.token}`)
    .send({ importString, dryRun: false });
}

/** First import (DINGER at 38) creates the guild; importer gets a grant. */
async function seedGuild(): Promise<Importer> {
  const token = await memberToken('realgm');
  const who = { token, charId: await createChar(token) };
  expect((await apply(who, snapshot(0, 38))).status).toBe(200);
  await grantMemberEditor(testApp.db, FIXTURE_GUID);
  return who;
}

const dings = () =>
  testApp.db
    .select()
    .from(schema.guildMemberLevelEvents)
    .orderBy(asc(schema.guildMemberLevelEvents.id));

const dingerRow = async () =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.guid, DINGER)),
    'dinger roster row',
  )[0];

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-1919 — guild re-import logs dings', () => {
  it('a first import of a new guild logs nothing', async () => {
    await seedGuild();
    expect(await dings()).toEqual([]);
  });

  it('a raised level logs ONE event from→to at the received instant', async () => {
    const who = await seedGuild();
    const res = await apply(who, snapshot(5, 41));
    expect([res.status, res.body.status]).toEqual([200, 'applied']);
    const member = await dingerRow();
    const rows = await dings();
    expect(
      rows.map((r) => [r.guildMemberId, r.guildId, r.fromLevel, r.toLevel]),
    ).toEqual([[member.id, member.guildId, 38, 41]]);
    expect(rows[0]?.occurredAt.getTime()).toBe(atStep(5));
  });

  it('re-applying the same payload logs nothing more', async () => {
    const who = await seedGuild();
    expect((await apply(who, snapshot(5, 41))).status).toBe(200);
    expect((await apply(who, snapshot(5, 41))).status).toBe(200);
    expect((await dings()).map((r) => r.toLevel)).toEqual([41]);
  });

  it('the same to_level reached again is not logged twice', async () => {
    const who = await seedGuild();
    expect((await apply(who, snapshot(5, 41))).status).toBe(200);
    expect((await apply(who, snapshot(6, 38))).status).toBe(200);
    expect((await apply(who, snapshot(7, 41))).status).toBe(200);
    const rows = await dings();
    expect(rows.map((r) => [r.fromLevel, r.toLevel])).toEqual([[38, 41]]);
    expect(rows[0]?.occurredAt.getTime()).toBe(atStep(5));
  });

  it('a lowered or unchanged level logs nothing', async () => {
    const who = await seedGuild();
    expect((await apply(who, snapshot(5, 38))).status).toBe(200);
    expect((await apply(who, snapshot(6, 30))).status).toBe(200);
    expect(await dings()).toEqual([]);
    expect((await dingerRow()).level).toBe(30);
  });

  it('a newly-joined member logs nothing', async () => {
    const who = await seedGuild();
    const recruit = buildMember(0x99, { level: 20 });
    expect((await apply(who, snapshot(5, 38, [recruit]))).status).toBe(200);
    expect(await dings()).toEqual([]);
  });

  it('a stale snapshot logs nothing', async () => {
    const who = await seedGuild();
    expect((await apply(who, snapshot(10, 38))).status).toBe(200);
    const res = await apply(who, snapshot(5, 45));
    expect([res.status, res.body.status]).toEqual([200, 'stale']);
    expect(await dings()).toEqual([]);
    expect((await dingerRow()).level).toBe(38);
  });
});

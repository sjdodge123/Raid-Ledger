/**
 * ROK-1916 AC2 — guild import stores export presence verbatim; a newer
 * snapshot overwrites it (NULL included), a stale one does not. The golden
 * `guild-1-page` fixture is only READ; mutations act on an in-test copy.
 * Harness copied from `addon-import-guild-dings.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
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
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const MEMBER_A = 'Player-4395-00000001';
const MEMBER_B = 'Player-4395-00000002';
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

async function importer(username: string): Promise<Importer> {
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
  const login = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token = login.body.access_token as string;
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
  return { token, charId: res.body.id as string };
}

const GOLDEN = readFileSync(join(FIXTURES, 'guild-1-page.json'), 'utf8');
type GuildFixture = { payload: { data: { members: AddonGuildMember[] } } };
/** A fresh copy of the golden roster — the fixture file is never written. */
const roster = (): AddonGuildMember[] =>
  (JSON.parse(GOLDEN) as GuildFixture).payload.data.members;

type Patch = (m: AddonGuildMember) => AddonGuildMember;
/** The golden roster `step` minutes after export, `patch` applied per row. */
function snapshot(step: number, patch: Patch = (m) => m): string {
  const payload = buildGuildPayload(roster().map(patch));
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

/** A online with no day count; B offline 40 days (AC2 "later snapshot"). */
const aOnlineBAway: Patch = (m) => {
  if (m.guid === MEMBER_B) return { ...m, lastOnlineDays: 40 };
  if (m.guid !== MEMBER_A) return m;
  const online: AddonGuildMember = { ...m, online: true };
  delete online.lastOnlineDays;
  return online;
};

/** A flips back offline with `lastOnlineDays: 0`; B keeps 40. */
const aBackOffline: Patch = (m) => {
  if (m.guid === MEMBER_A) return { ...m, online: false, lastOnlineDays: 0 };
  return m.guid === MEMBER_B ? { ...m, lastOnlineDays: 40 } : m;
};

type Importer = { token: string; charId: string };
async function apply(who: Importer, importString: string) {
  return testApp.request
    .post(`/plugins/wow/characters/${who.charId}/addon-import`)
    .set('Authorization', `Bearer ${who.token}`)
    .send({ importString, dryRun: false });
}

/** First import (the golden roster) creates the guild; importer gets a grant. */
async function seedGuild(): Promise<Importer> {
  const who = await importer('realgm');
  expect((await apply(who, snapshot(0))).status).toBe(200);
  await grantMemberEditor(testApp.db, FIXTURE_GUID);
  return who;
}

/** guid → [online_at_export, last_online_days] for every stored member. */
type Presence = [boolean | null, number | null];
async function presence(): Promise<Map<string, Presence>> {
  const rows = await testApp.db
    .select({
      guid: schema.guildMembers.guid,
      online: schema.guildMembers.onlineAtExport,
      days: schema.guildMembers.lastOnlineDays,
    })
    .from(schema.guildMembers);
  return new Map(rows.map((r) => [r.guid ?? '', [r.online, r.days]]));
}

async function expectAppliedAt(who: Importer, step: number, patch: Patch) {
  const res = await apply(who, snapshot(step, patch));
  expect([res.status, res.body.status]).toEqual([200, 'applied']);
}

beforeAll(async () => (testApp = await getTestApp()));

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

describe('ROK-1916 — guild import stores export presence', () => {
  it('the golden roster stores offline / 2 days for every member', async () => {
    await seedGuild();
    const stored = await presence();
    expect(stored.size).toBe(roster().length);
    expect(new Set([...stored.values()].map((p) => p.join('/')))).toEqual(
      new Set(['false/2']),
    );
  });

  it('a later snapshot overwrites both columns, NULL included', async () => {
    const who = await seedGuild();
    await expectAppliedAt(who, 5, aOnlineBAway);
    const stored = await presence();
    expect(stored.get(MEMBER_A)).toEqual([true, null]);
    expect(stored.get(MEMBER_B)).toEqual([false, 40]);
    expect(stored.get(FIXTURE_GUID)).toEqual([false, 2]);
  });

  it('a re-import flipping A offline with 0 days stores false / 0', async () => {
    const who = await seedGuild();
    await expectAppliedAt(who, 5, aOnlineBAway);
    await expectAppliedAt(who, 6, aBackOffline);
    const stored = await presence();
    expect(stored.get(MEMBER_A)).toEqual([false, 0]);
    expect(stored.get(MEMBER_B)).toEqual([false, 40]);
  });

  it('a stale snapshot changes neither column', async () => {
    const who = await seedGuild();
    await expectAppliedAt(who, 10, aOnlineBAway);
    const res = await apply(who, snapshot(5, aBackOffline));
    expect([res.status, res.body.status]).toEqual([200, 'stale']);
    const stored = await presence();
    expect(stored.get(MEMBER_A)).toEqual([true, null]);
    expect(stored.get(MEMBER_B)).toEqual([false, 40]);
  });
});

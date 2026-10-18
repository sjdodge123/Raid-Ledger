/**
 * ROK-1794 (2026-10-18 security review) — an unsigned guild snapshot must not
 * let a non-member take over a stored roster, evict real members wholesale,
 * or post-date itself past honest imports. Setup copied from
 * `addon-import.integration.spec.ts` (ROK-1724) — `POST /plugins/wow/characters/:id/addon-import` against a real
 * database, driven by the LedgerLink v1 golden fixtures
 * (`packages/contract/ledgerlink/v1/fixtures`). Covers preview/apply per
 * section, noop/stale (stale writes nothing), the binding rejects, owner +
 * plugin gating, 413/429, and one audit row per attempt (rejects included).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { count, eq, gte } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_GUID,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildWho,
} from './testing/addon-fixture.builder';
import { FIXTURE_NOW_MS, pinExportClock } from './testing/pin-export-clock';
import type { AddonGuildMember } from '@raid-ledger/contract';

const nonNull = <T>(v: T | null): T => {
  if (v === null) throw new Error('expected a value');
  return v;
};

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

async function createChar(
  token: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
      ...body,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const post = (
  token: string,
  charId: string,
  importString: string,
  extra: Record<string, unknown> = {},
) =>
  testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString, ...extra });

const apply = (token: string, id: string, s: string, extra = {}) =>
  post(token, id, s, { dryRun: false, ...extra });

const rowCount = async (table: PgTable): Promise<number> => {
  const [row] = await testApp.db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
};

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame(FOREVER_SLUG, 'World of Warcraft: Forever');
  // truncateAllTables may wipe `plugins`; re-install, then activate.
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

const AC = (n: number) => `ROK-1794 AC${n}`;
const NIGHT_SHIFT = 'Night Shift';
interface GuildFixture {
  payload: { data: { members: AddonGuildMember[] } };
}
const roster = () =>
  fixtureJson<GuildFixture>('guild-1-page').payload.data.members;
const guildRow = async () =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.name, NIGHT_SHIFT)),
    'guild',
  )[0];

/** A real member (FIXTURE_GUID) creates the 40-member guild and is pinned. */
async function seedRealGuild(): Promise<{ token: string; id: string }> {
  const token = await memberToken('realgm');
  const id = await createChar(token);
  expect((await apply(token, id, fixture('guild-1-page'))).status).toBe(200);
  return { token, id };
}

describe('ROK-1794 — unsigned guild snapshots', () => {
  it(`${AC(2)}: a non-member's forged roster is rejected and writes nothing`, async () => {
    await seedRealGuild();
    const before = await guildRow();
    const token = await memberToken('forger');
    const id = await createChar(token);
    const forgerGuid = 'Player-4395-0000BEEF';
    const forged = buildGuildPayload([
      ...roster(),
      buildMember(0xbeef, { guid: forgerGuid, rankIndex: 1, rank: 'Officer' }),
    ]);
    forged.who = buildWho({ guid: forgerGuid });
    const res = await apply(token, id, buildImportString(forged));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_IN_GUILD');
    expect(await rowCount(schema.guildMembers)).toBe(40);
    expect(await guildRow()).toEqual(before);
  });

  it(`${AC(4)}: a one-member roster from a real member is held, roster kept`, async () => {
    const { token, id } = await seedRealGuild();
    const self = roster().filter((m) => m.guid === FIXTURE_GUID);
    const res = await apply(
      token,
      id,
      buildImportString(buildGuildPayload(self)),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    const g = await guildRow();
    const live = await testApp.db
      .select()
      .from(schema.guildMembers)
      .where(gte(schema.guildMembers.lastSeenAt, nonNull(g.lastSnapshotAt)));
    expect(live).toHaveLength(40);
  });

  it(`${AC(3)}: a post-dated snapshot is stored at the server clock`, async () => {
    const { token, id } = await seedRealGuild();
    const ahead = buildGuildPayload(roster());
    ahead.data.snapshotAt = FIXTURE_NOW_MS / 1000 + 23 * 3600;
    expect((await apply(token, id, buildImportString(ahead))).status).toBe(200);
    expect((await guildRow()).lastSnapshotAt?.getTime()).toBe(FIXTURE_NOW_MS);
  });

  it(`${AC(6)}: an applied roster records which user replaced it`, async () => {
    await seedRealGuild();
    const g = await guildRow();
    const rows = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, 'guild_roster_replaced'));
    expect(rows).toEqual([
      expect.objectContaining({ entityType: 'guild', entityId: g.id }),
    ]);
    expect(rows[0]?.actorId).toEqual(expect.any(Number));
  });
});

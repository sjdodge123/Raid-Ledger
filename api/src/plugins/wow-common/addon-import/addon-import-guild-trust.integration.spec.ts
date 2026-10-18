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
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
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
    // AC4 "flagged to admins": the admin gets an in-app notice (the held
    // roster is rolled back, the flag is written after the transaction).
    const flags = await testApp.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, testApp.seed.adminUser.id),
          eq(schema.notifications.type, 'system'),
        ),
      );
    expect(flags).toEqual([
      expect.objectContaining({
        title: 'Guild roster import held',
        payload: expect.objectContaining({
          guildId: g.id,
          removed: 39,
          live: 40,
        }),
      }),
    ]);
  });
});

/** The real roster minus the first `n` other members, `step` minutes later. */
function sliced(n: number, step: number): string {
  const others = roster().filter((m) => m.guid !== FIXTURE_GUID);
  const dropped = new Set(others.slice(0, n).map((m) => m.guid));
  const payload = buildGuildPayload(
    roster().filter((m) => !dropped.has(m.guid)),
  );
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

const liveCount = async (): Promise<number> => {
  const g = await guildRow();
  const live = await testApp.db
    .select()
    .from(schema.guildMembers)
    .where(gte(schema.guildMembers.lastSeenAt, nonNull(g.lastSnapshotAt)));
  return live.length;
};

describe('ROK-1794 — removals over a rolling window (review r1)', () => {
  it(`${AC(4)}: dropping 4 members an import is held once the day's total is wholesale`, async () => {
    const { token, id } = await seedRealGuild();
    expect((await apply(token, id, sliced(4, 1))).status).toBe(200);
    expect((await apply(token, id, sliced(8, 2))).status).toBe(200);
    expect(await liveCount()).toBe(32);
    // 12 of the 40 the guild had inside the window: over a quarter → held.
    const res = await apply(token, id, sliced(12, 3));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    expect(await liveCount()).toBe(32);
    const audits = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, 'guild_roster_replaced'))
      .orderBy(schema.activityLog.id);
    expect(audits.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ removed: 0 }),
      expect.objectContaining({ removed: 4 }),
      expect.objectContaining({ removed: 4 }),
    ]);
  });
});

/** The roster minus `strip` real others, plus `fakes` invented GUIDs. */
function padded(fakes: number, strip: number, step: number): string {
  const others = roster().filter((m) => m.guid !== FIXTURE_GUID);
  const dropped = new Set(others.slice(0, strip).map((m) => m.guid));
  const fake = Array.from({ length: fakes }, (_, i) =>
    buildMember(0xfa000000 + i),
  );
  const kept = roster().filter((m) => !dropped.has(m.guid));
  const payload = buildGuildPayload([...kept, ...fake]);
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}

describe('ROK-1794 — padding the roster (review r2)', () => {
  it(`${AC(4)}: adding over a quarter of the roster at once is held`, async () => {
    const { token, id } = await seedRealGuild();
    const res = await apply(token, id, padded(11, 0, 1));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    expect(await liveCount()).toBe(40);
  });

  it(`${AC(4)}: members added inside the window don't grow the removal baseline`, async () => {
    const { token, id } = await seedRealGuild();
    expect((await apply(token, id, padded(10, 0, 1))).status).toBe(200);
    expect(await liveCount()).toBe(50);
    // 11 real members of the 40 the guild had at the window's start: held,
    // though 11 is under a quarter of the padded 50.
    const res = await apply(token, id, padded(10, 11, 2));
    expect(res.status).toBe(422);
    expect(await liveCount()).toBe(50);
  });

  it(`${AC(4)}: removals older than the window stop counting`, async () => {
    const { token, id } = await seedRealGuild();
    expect((await apply(token, id, sliced(4, 1))).status).toBe(200);
    expect((await apply(token, id, sliced(8, 2))).status).toBe(200);
    await testApp.db
      .update(schema.activityLog)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(schema.activityLog.action, 'guild_roster_replaced'));
    expect((await apply(token, id, sliced(12, 3))).status).toBe(200);
    expect(await liveCount()).toBe(28);
  });
});

describe('ROK-1794 — staff, snapshot clock and audit', () => {
  it(`${AC(2)}: staff may replace any roster, wholesale included`, async () => {
    await seedRealGuild();
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const id = await createChar(token);
    const staffGuid = 'Player-4395-0000CAFE';
    const solo = buildGuildPayload([buildMember(0xcafe, { guid: staffGuid })]);
    solo.who = buildWho({ guid: staffGuid });
    const res = await apply(token, id, buildImportString(solo));
    expect(res.status).toBe(200);
    expect((await guildRow()).memberCount).toBe(1);
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

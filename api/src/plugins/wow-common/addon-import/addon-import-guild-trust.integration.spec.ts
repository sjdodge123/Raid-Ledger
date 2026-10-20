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
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
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
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildWho,
} from './testing/addon-fixture.builder';
import { NOT_AN_EDITOR_MESSAGE } from './addon-import-guild.guard';
import { ROSTER_HELD_TITLE } from './addon-import-guild.flag';
import { grantMemberEditor } from './testing/grant-member-editor';
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

/**
 * A Forever name+region is one player's (`wow-forever-identity`): a second
 * importer's character must use another name, or `POST /users/me/characters`
 * answers 409. The export's `who` must carry that same name (NAME_MISMATCH).
 */
const OTHER_NAME = 'Bob Forever';
const otherChar = (token: string, name = OTHER_NAME): Promise<string> =>
  createChar(token, { name });
const whoAsOther = (guid: string, name = OTHER_NAME) =>
  buildWho({
    guid,
    fullName: name,
    raw: { getUnitName: name, unitName: [name, null] },
  });

/**
 * The editor guard's refusal (review P3): `assertExporterInGuild` answers the
 * same code for a shape miss, so only the message proves the guard fired.
 */
const expectNotEditor = (res: {
  status: number;
  body: { code?: string; message?: string };
}) =>
  expect([res.status, res.body.code, res.body.message]).toEqual([
    422,
    'NOT_IN_GUILD',
    NOT_AN_EDITOR_MESSAGE,
  ]);

/** A real member (FIXTURE_GUID) creates the 40-member guild and is pinned. */
async function seedRealGuild(): Promise<{ token: string; id: string }> {
  const token = await memberToken('realgm');
  const id = await createChar(token);
  expect((await apply(token, id, fixture('guild-1-page'))).status).toBe(200);
  // Explicit grants only (ruling 2026-10-19): staff made the GM an editor.
  await grantMemberEditor(testApp.db, FIXTURE_GUID);
  return { token, id };
}

describe('ROK-1794 — unsigned guild snapshots', () => {
  it(`${AC(2)}: a non-member's forged roster is rejected and writes nothing`, async () => {
    await seedRealGuild();
    const before = await guildRow();
    const token = await memberToken('forger');
    const id = await otherChar(token);
    const forgerGuid = 'Player-4395-0000BEEF';
    const forged = buildGuildPayload([
      ...roster(),
      buildMember(0xbeef, { guid: forgerGuid, rankIndex: 1, rank: 'Officer' }),
    ]);
    forged.who = whoAsOther(forgerGuid);
    const res = await apply(token, id, buildImportString(forged));
    expectNotEditor(res);
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
    const id = await otherChar(token);
    const staffGuid = 'Player-4395-0000CAFE';
    const solo = buildGuildPayload([buildMember(0xcafe, { guid: staffGuid })]);
    solo.who = whoAsOther(staffGuid);
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

describe('ROK-1794 — concurrent imports and the character-less route (Codex P2)', () => {
  it(`${AC(4)}: two concurrent identical imports count a removal once`, async () => {
    const { token, id } = await seedRealGuild();
    const s = sliced(4, 1);
    const [a, b] = await Promise.all([
      apply(token, id, s),
      apply(token, id, s),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const audits = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, 'guild_roster_replaced'));
    const removed = audits.map(
      (r) => (r.metadata as { removed?: number }).removed ?? 0,
    );
    expect(removed.reduce((x, y) => x + y, 0)).toBe(4);
    expect(await liveCount()).toBe(36);
  });

  it(`${AC(4)}: a roster held on the character-less route notifies admins`, async () => {
    const { token } = await seedRealGuild();
    const self = roster().filter((m) => m.guid === FIXTURE_GUID);
    const res = await testApp.request
      .post('/plugins/wow/characters/addon-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importString: buildImportString(buildGuildPayload(self)),
        dryRun: false,
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    expect(await liveCount()).toBe(40);
    const flags = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, testApp.seed.adminUser.id));
    expect(flags).toEqual([
      expect.objectContaining({ title: 'Guild roster import held' }),
    ]);
  });
});

/** Roster GUID `i` ([0] is the GM's FIXTURE_GUID), unlinked until pinned. */
const rosterGuid = (i: number): string => {
  const m = roster()[i];
  if (!m) throw new Error(`no roster member ${i}`);
  return m.guid;
};
const memberRank = async (guid: string): Promise<number | null> =>
  nonEmpty(
    await testApp.db
      .select({ rank: schema.guildMembers.rankIndex })
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.guid, guid)),
    'member',
  )[0].rank;

/** A new user whose character pins roster GUID `guid` by a character export. */
async function linkRosterMember(user: string, guid: string, name: string) {
  const token = await memberToken(user);
  const id = await otherChar(token, name);
  const pin = buildCharPayload({ who: whoAsOther(guid, name) });
  expect((await apply(token, id, buildImportString(pin))).status).toBe(200);
  return { token, id };
}

type Edit = (ms: AddonGuildMember[]) => AddonGuildMember[];
/** The real roster, edited, exported by `guid` (as `name`) `step` min later. */
function rosterAs(guid: string, name: string, step: number, edit: Edit) {
  const payload = buildGuildPayload(edit(roster()));
  payload.who = whoAsOther(guid, name);
  payload.data.snapshotAt += step * 60;
  return buildImportString(payload);
}
const asIs: Edit = (ms) => ms;
const promote =
  (guid: string): Edit =>
  (ms) =>
    ms.map((m) => (m.guid === guid ? { ...m, rankIndex: 0, rank: 'GM' } : m));
/** Drop `n` members other than the GM and `keep`. */
const dropOthers =
  (n: number, keep: string): Edit =>
  (ms) => {
    const others = ms.filter((m) => ![FIXTURE_GUID, keep].includes(m.guid));
    const gone = new Set(others.slice(0, n).map((m) => m.guid));
    return ms.filter((m) => !gone.has(m.guid));
  };

describe('ROK-1794 — explicit grants only (operator ruling 2026-10-19)', () => {
  it(`${AC(2)}: a GUID claimed by a forged character export earns no re-import, even after another importer's import`, async () => {
    const gm = await seedRealGuild();
    const y = rosterGuid(1);
    const forger = await linkRosterMember('forger', y, OTHER_NAME);
    const rankBefore = await memberRank(y);
    const forged = await apply(
      forger.token,
      forger.id,
      rosterAs(y, OTHER_NAME, 1, promote(y)),
    );
    expectNotEditor(forged);
    // The real GM (a member editor) carries the roster in a newer import —
    // the dropped corroboration path would have let the forger in after it.
    expect((await apply(gm.token, gm.id, sliced(0, 2))).status).toBe(200);
    const before = await guildRow();
    const again = await apply(
      forger.token,
      forger.id,
      rosterAs(y, OTHER_NAME, 3, promote(y)),
    );
    expectNotEditor(again);
    expect(await guildRow()).toEqual(before);
    expect(await memberRank(y)).toBe(rankBefore);
  });

  it(`${AC(2)}: the guild's creator may not re-import it without a grant`, async () => {
    const token = await memberToken('creator');
    const id = await createChar(token);
    expect((await apply(token, id, fixture('guild-1-page'))).status).toBe(200);
    const before = await guildRow();
    const res = await apply(token, id, sliced(0, 1));
    expectNotEditor(res);
    expect(await guildRow()).toEqual(before);
  });

  it.each([
    ['a plain roster member', false],
    ['a rank-grant holder (rank grants confer nothing)', true],
  ])(`${AC(2)}: %s may not re-import`, async (_label, rankGrant) => {
    await seedRealGuild();
    const y = rosterGuid(1);
    if (rankGrant) {
      await testApp.db.insert(schema.guildEditors).values({
        guildId: (await guildRow()).id,
        kind: 'rank',
        rankIndex: nonNull(await memberRank(y)),
      });
    }
    const m = await linkRosterMember('plain', y, OTHER_NAME);
    const before = await guildRow();
    const res = await apply(m.token, m.id, rosterAs(y, OTHER_NAME, 1, asIs));
    expectNotEditor(res);
    expect(await guildRow()).toEqual(before);
  });
});

describe('ROK-1794 — member grants on a confirmed link', () => {
  it(`${AC(2)}/${AC(4)}: an officer staff made a member editor re-imports, and the hold still applies`, async () => {
    await seedRealGuild();
    const y = rosterGuid(1);
    const officer = await linkRosterMember('officer', y, OTHER_NAME);
    await grantMemberEditor(testApp.db, y);
    const ok = await apply(
      officer.token,
      officer.id,
      rosterAs(y, OTHER_NAME, 1, dropOthers(4, y)),
    );
    expect(ok.status).toBe(200);
    expect(await liveCount()).toBe(36);
    const held = await apply(
      officer.token,
      officer.id,
      rosterAs(y, OTHER_NAME, 2, dropOthers(30, y)),
    );
    expect(held.status).toBe(422);
    expect(held.body.code).toBe('INVALID_PAYLOAD');
    expect(await liveCount()).toBe(36);
  });

  it(`${AC(5)}: a character that pins the granted GUID after the grant is refused`, async () => {
    await seedRealGuild();
    const y = rosterGuid(1);
    const token = await memberToken('latecomer');
    const id = await otherChar(token); // exists before the grant, unpinned
    await grantMemberEditor(testApp.db, y);
    const pin = buildCharPayload({ who: whoAsOther(y) });
    expect((await apply(token, id, buildImportString(pin))).status).toBe(200);
    const before = await guildRow();
    const res = await apply(token, id, rosterAs(y, OTHER_NAME, 1, asIs));
    expectNotEditor(res);
    expect(await guildRow()).toEqual(before);
  });
});

describe('ROK-1794 review P3 — a created character', () => {
  it(`${AC(5)}: a character the CREATE route makes on the granted GUID after the grant is refused, by creation time alone`, async () => {
    await seedRealGuild();
    const y = rosterGuid(1);
    await grantMemberEditor(testApp.db, y);
    const token = await memberToken('created');
    const made = await testApp.request
      .post('/plugins/wow/characters/addon-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importString: buildImportString(
          buildCharPayload({ who: whoAsOther(y) }),
        ),
        dryRun: false,
      });
    expect([made.status, made.body.target?.action]).toEqual([200, 'create']);
    const id = made.body.target.characterId as string;
    // The create route audits its GUID claim (so `claimedSinceGrant` refuses
    // it too). Drop that row: creation time alone —
    // `lte(c.createdAt, ge.createdAt)` — must still refuse a character born
    // after the grant (review P3).
    const claims = await testApp.db
      .select({ id: schema.activityLog.id })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.action, 'addon_guid_claimed'),
          sql`${schema.activityLog.metadata}->>'characterId' = ${id}`,
        ),
      );
    expect(claims).toHaveLength(1);
    const claimIds = claims.map((c) => c.id);
    await testApp.db
      .delete(schema.activityLog)
      .where(inArray(schema.activityLog.id, claimIds));
    const before = await guildRow();
    const res = await apply(token, id, rosterAs(y, OTHER_NAME, 1, asIs));
    expectNotEditor(res);
    expect(await guildRow()).toEqual(before);
  });
});

describe('ROK-1794 review P3 — held-roster flag', () => {
  it(`${AC(4)}: a held PREVIEW flags no one; the held apply flags every active admin and operator`, async () => {
    const { token, id } = await seedRealGuild();
    const [op] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:op@test.local',
          username: 'op',
          role: 'operator',
        })
        .returning(),
      'operator',
    );
    const self = roster().filter((m) => m.guid === FIXTURE_GUID);
    const held = buildImportString(buildGuildPayload(self));
    const flagged = async () =>
      (
        await testApp.db
          .select({ userId: schema.notifications.userId })
          .from(schema.notifications)
          .where(eq(schema.notifications.title, ROSTER_HELD_TITLE))
      )
        .map((r) => r.userId)
        .sort((a, b) => a - b);
    const preview = await post(token, id, held, { dryRun: true });
    expect([preview.status, preview.body.code]).toEqual([
      422,
      'INVALID_PAYLOAD',
    ]);
    expect(await flagged()).toEqual([]);
    const res = await apply(token, id, held);
    expect([res.status, res.body.code]).toEqual([422, 'INVALID_PAYLOAD']);
    const staff = await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.role, ['admin', 'operator']));
    expect(staff.map((u) => u.id)).toContain(op.id);
    expect(await flagged()).toEqual(
      staff.map((u) => u.id).sort((a, b) => a - b),
    );
  });
});

/**
 * ROK-1737 "Export all" — `POST /plugins/wow/characters/:id/addon-import`
 * with a mixed char + guild + raid paste against a real database, driven by
 * the LedgerLink v1 mixed golden fixtures. Preview returns one entry per
 * section; apply writes every section in ONE transaction; a rejecting
 * section writes NOTHING; one audit row per section; one paste = one
 * rate-limit reservation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { count, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ADDON_IMPORT_APPLY_LIMIT } from './addon-import.audit';
import {
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildRaidPayload,
  buildWho,
} from './testing/addon-fixture.builder';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');

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
    'game',
  );
  return game.id;
}

/** A member + their token + a matching Forever character. */
async function memberWithChar(username: string) {
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
  return { userId: user.id, token, charId: res.body.id as string };
}

const post = (token: string, charId: string, s: string, dryRun = true) =>
  testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, dryRun });

const rowCount = async (table: PgTable): Promise<number> => {
  const [row] = await testApp.db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
};

const audits = () =>
  testApp.db
    .select()
    .from(schema.addonImportAudit)
    .orderBy(schema.addonImportAudit.id);

/** Every table a section writes: char snapshot, guild + roster, pulls. */
const writtenRows = async () => ({
  snapshots: await rowCount(schema.characterAddonSnapshots),
  guilds: await rowCount(schema.guilds),
  members: await rowCount(schema.guildMembers),
  pulls: await rowCount(schema.addonEncounterPulls),
});

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

describe('addon import — mixed paste preview', () => {
  it('char + raid → 2 section entries, nothing written', async () => {
    const { token, charId } = await memberWithChar('anamix2');
    const res = await post(token, charId, fixture('mixed-char-raid'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ section: 'char', status: 'preview' });
    expect(res.body.sections).toMatchObject([
      { section: 'char', status: 'preview', summary: { gearCount: 2 } },
      { section: 'raid', status: 'preview', summary: { pulls: 1 } },
    ]);
    expect(await writtenRows()).toEqual({
      snapshots: 0,
      guilds: 0,
      members: 0,
      pulls: 0,
    });
  });

  it('shuffled char + 3-page guild + raid → 3 entries in canonical order', async () => {
    const { token, charId } = await memberWithChar('anamix3');
    const res = await post(
      token,
      charId,
      fixture('mixed-char-guild3-raid-shuffled'),
    );
    expect(res.status).toBe(200);
    expect(res.body.sections).toMatchObject([
      { section: 'char', status: 'preview' },
      { section: 'guild', summary: { members: 600, pages: 3 } },
      { section: 'raid', summary: { pulls: 1 } },
    ]);
  });
});

describe('addon import — mixed paste apply', () => {
  it('writes every section in one go; one audit row per section, one reservation instant', async () => {
    const { token, charId } = await memberWithChar('anamixapply');
    const s = fixture('mixed-char-guild3-raid-shuffled');
    const res = await post(token, charId, s, false);
    expect(res.status).toBe(200);
    expect(
      (res.body.sections as Array<{ status: string }>).map((x) => x.status),
    ).toEqual(['applied', 'applied', 'applied']);
    expect(await writtenRows()).toEqual({
      snapshots: 1,
      guilds: 1,
      members: 600,
      pulls: 1,
    });
    const rows = await audits();
    expect(rows.map((r) => [r.section, r.result])).toEqual([
      ['char', 'applied'],
      ['guild', 'applied'],
      ['raid', 'applied'],
    ]);
    expect(new Set(rows.map((r) => r.payloadSha256)).size).toBe(3);
    expect(new Set(rows.map((r) => r.createdAt.getTime())).size).toBe(1);
    expect(JSON.stringify(rows)).not.toContain('!RL1!');
  });

  it('a guild section rejecting NOT_IN_GUILD writes NOTHING — not the char, raid or GUID pin', async () => {
    const { token, charId } = await memberWithChar('anamixreject');
    const who = buildWho({ guid: 'Player-4395-0000BEEF' });
    const parts = [
      { ...buildCharPayload(), who },
      { ...buildGuildPayload(), who },
      { ...buildRaidPayload(), who },
    ].map((p) => buildImportString(p));
    const res = await post(token, charId, parts.join('\n'), false);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_IN_GUILD');
    expect(await writtenRows()).toEqual({
      snapshots: 0,
      guilds: 0,
      members: 0,
      pulls: 0,
    });
    const [character] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, charId));
    expect(character?.addonGuid).toBeNull();
    const results = (await audits()).map((r) => [r.section, r.result]);
    expect(results).toEqual([
      ['char', 'NOT_IN_GUILD'],
      ['guild', 'NOT_IN_GUILD'],
      ['raid', 'NOT_IN_GUILD'],
    ]);
  });

  it('a mixed paste counts ONCE against the hourly apply limit', async () => {
    process.env.THROTTLE_DISABLED = 'false';
    const { userId, token, charId } = await memberWithChar('anamixlimit');
    // LIMIT - 3 earlier applies, each its own reservation instant.
    const earlier = Array.from(
      { length: ADDON_IMPORT_APPLY_LIMIT - 3 },
      (_, i) => ({
        userId,
        characterId: charId,
        sizeBytes: 10,
        dryRun: false,
        result: 'applied',
        createdAt: sql`now() - make_interval(secs => ${i + 1})`,
      }),
    );
    await testApp.db.insert(schema.addonImportAudit).values(earlier);
    const mixed = await post(token, charId, fixture('mixed-char-raid'), false);
    expect(mixed.status).toBe(200);
    // 3 section rows, 1 paste: two more single applies still fit (18, 19 → 20)…
    for (let i = 0; i < 2; i++) {
      const single = await post(token, charId, fixture('raid'), false);
      expect(single.status).toBe(200);
    }
    // …and only then the cap is reached.
    const limited = await post(token, charId, fixture('raid'), false);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });
});

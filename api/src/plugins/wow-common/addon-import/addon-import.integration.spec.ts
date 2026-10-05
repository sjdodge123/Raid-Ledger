/**
 * ROK-1724 — `POST /plugins/wow/characters/:id/addon-import` against a real
 * database, driven by the LedgerLink v1 golden fixtures
 * (`packages/contract/ledgerlink/v1/fixtures`). Covers preview/apply per
 * section, noop/stale (stale writes nothing), the binding rejects, owner +
 * plugin gating, 413/429, and one audit row per attempt (rejects included).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  FIXTURE_GUID,
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildWho,
} from './testing/addon-fixture.builder';

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

const audits = () =>
  testApp.db
    .select()
    .from(schema.addonImportAudit)
    .orderBy(schema.addonImportAudit.id);

const charRow = async (id: string) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, id)),
    'character',
  )[0];

/** A char export with a shifted `exportedAt` (older/newer than the fixture). */
const charAt = (exportedAt: number) =>
  buildImportString(buildCharPayload({ exportedAt }));

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

describe('addon import — char', () => {
  it('previews without writing, applies, pins the GUID, then noop + stale', async () => {
    const token = await memberToken('anachar');
    const id = await createChar(token);

    const preview = await post(token, id, fixture('char-normal'));
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ section: 'char', status: 'preview' });
    expect(await rowCount(schema.characterAddonSnapshots)).toBe(0);
    expect((await charRow(id)).addonGuid).toBeNull();

    const applied = await apply(token, id, fixture('char-normal'));
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('applied');
    expect(applied.body.summary).toMatchObject({ gearCount: 2, lockouts: 1 });
    expect(await rowCount(schema.characterAddonSnapshots)).toBe(1);
    expect((await charRow(id)).addonGuid).toBe(FIXTURE_GUID);

    const again = await apply(token, id, fixture('char-normal'));
    expect(again.body.status).toBe('noop');

    const before = await testApp.db
      .select()
      .from(schema.characterAddonSnapshots);
    const charBefore = await charRow(id);
    const stale = await apply(token, id, charAt(FIXTURE_EXPORTED_AT - 3600));
    expect(stale.status).toBe(200);
    expect(stale.body.status).toBe('stale');
    expect(
      await testApp.db.select().from(schema.characterAddonSnapshots),
    ).toEqual(before);
    expect(await charRow(id)).toEqual(charBefore);
  });

  it('a stale export writes nothing — not even the class/level binding update', async () => {
    const token = await memberToken('anastale');
    const id = await createChar(token);
    expect((await apply(token, id, fixture('char-normal'))).body.status).toBe(
      'applied',
    );
    // Drift the character so a non-stale apply WOULD write class/level.
    await testApp.db
      .update(schema.characters)
      .set({ level: 10, class: 'Warrior' })
      .where(eq(schema.characters.id, id));
    const res = await apply(token, id, charAt(FIXTURE_EXPORTED_AT - 60));
    expect(res.body.status).toBe('stale');
    const row = await charRow(id);
    expect({ level: row.level, class: row.class }).toEqual({
      level: 10,
      class: 'Warrior',
    });
  });

  it('GUID_CONFIRM_REQUIRED on a changed GUID, then re-pins with repinGuid', async () => {
    const token = await memberToken('anaguid');
    const id = await createChar(token);
    await testApp.db
      .update(schema.characters)
      .set({ addonGuid: 'Player-4395-0000FFFF' })
      .where(eq(schema.characters.id, id));

    const preview = await post(token, id, fixture('char-normal'));
    expect(preview.status).toBe(200);
    expect(preview.body.warnings).toContainEqual(
      expect.objectContaining({ code: 'GUID_CHANGED', to: FIXTURE_GUID }),
    );

    const refused = await apply(token, id, fixture('char-normal'));
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('GUID_CONFIRM_REQUIRED');
    expect(await rowCount(schema.characterAddonSnapshots)).toBe(0);

    const repinned = await apply(token, id, fixture('char-normal'), {
      confirm: { repinGuid: true },
    });
    expect(repinned.status).toBe(200);
    expect((await charRow(id)).addonGuid).toBe(FIXTURE_GUID);
  });
});

describe('addon import — binding rejects', () => {
  it('WRONG_GAME for a character of another game', async () => {
    const token = await memberToken('anawrong');
    const id = await createChar(token, {
      gameId: testApp.seed.game.id,
      region: undefined,
      ruleset: undefined,
    });
    const res = await post(token, id, fixture('char-normal'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WRONG_GAME');
  });

  it('REGION_MISMATCH when the export region differs', async () => {
    const token = await memberToken('anaregion');
    const id = await createChar(token, { region: 'eu' });
    const res = await post(token, id, fixture('char-normal'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REGION_MISMATCH');
  });

  it('NAME_MISMATCH carries the Add Character prefill', async () => {
    const token = await memberToken('ananame');
    const id = await createChar(token, { name: 'Bob Forever' });
    const res = await post(token, id, fixture('char-normal'));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'NAME_MISMATCH',
      addCharacter: {
        firstName: 'Ana',
        secondName: 'Forever',
        region: 'us',
        ruleset: 'normal',
        class: 'Paladin',
      },
    });
  });

  it('officerNote (unknown key) → 422 INVALID_PAYLOAD, nothing written', async () => {
    const token = await memberToken('anaofficer');
    const id = await createChar(token);
    const paste = readFileSync(
      join(FIXTURES, 'invalid', 'unknown-key-officer-note.txt'),
      'utf8',
    );
    const res = await apply(token, id, paste);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PAYLOAD');
    expect(await rowCount(schema.guilds)).toBe(0);
    expect(await rowCount(schema.guildMembers)).toBe(0);
  });
});

describe('addon import — guild', () => {
  interface GuildFixture {
    payload: { data: { members: Array<{ guid: string }> } };
  }

  it('creates guild + members, bumps last_seen_at, an older snapshot is stale', async () => {
    const token = await memberToken('anaguild');
    const id = await createChar(token);
    const first = await apply(token, id, fixture('guild-1-page'));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      section: 'guild',
      status: 'applied',
      summary: { guildName: 'Night Shift', members: 40, newMembers: 40 },
    });
    expect(await rowCount(schema.guilds)).toBe(1);
    expect(await rowCount(schema.guildMembers)).toBe(40);

    const { members } = fixtureJson<GuildFixture>('guild-1-page').payload.data;
    const newer = buildGuildPayload(members as never);
    newer.data.snapshotAt = FIXTURE_EXPORTED_AT + 3600;
    newer.exportedAt = FIXTURE_EXPORTED_AT + 3600;
    const second = await apply(token, id, buildImportString(newer));
    expect(second.body).toMatchObject({
      status: 'applied',
      summary: { newMembers: 0 },
    });
    const [exporter] = await testApp.db
      .select()
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.guid, FIXTURE_GUID));
    expect(exporter?.lastSeenAt?.getTime()).toBe(
      (FIXTURE_EXPORTED_AT + 3600) * 1000,
    );

    const guildsBefore = await testApp.db.select().from(schema.guilds);
    const membersBefore = await testApp.db.select().from(schema.guildMembers);
    const older = await apply(token, id, fixture('guild-1-page'));
    expect(older.body.status).toBe('stale');
    expect(await testApp.db.select().from(schema.guilds)).toEqual(guildsBefore);
    expect(await testApp.db.select().from(schema.guildMembers)).toEqual(
      membersBefore,
    );
  });

  it('applies the 3-page and 2000-member 8-page fixtures', async () => {
    const token = await memberToken('anapages');
    const id = await createChar(token);
    const three = await apply(token, id, fixture('guild-3-pages'));
    expect(three.body).toMatchObject({
      status: 'applied',
      summary: { members: 600, pages: 3 },
    });
    const eight = await post(token, id, fixture('guild-8-pages-2000-members'));
    expect(eight.status).toBe(200);
    expect(eight.body.summary).toMatchObject({ members: 2000, pages: 8 });
  });

  it('exporter missing from the roster → 422 NOT_IN_GUILD, no rows', async () => {
    const token = await memberToken('ananotin');
    const id = await createChar(token);
    const payload = buildGuildPayload();
    payload.who = buildWho({ guid: 'Player-4395-0000BEEF' });
    const res = await apply(token, id, buildImportString(payload));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_IN_GUILD');
    expect(await rowCount(schema.guilds)).toBe(0);
  });
});

describe('addon import — raid', () => {
  it('re-applying counts duplicates and inserts no new rows', async () => {
    const token = await memberToken('anaraid');
    const id = await createChar(token);
    const first = await apply(token, id, fixture('raid'));
    expect(first.body).toMatchObject({
      section: 'raid',
      status: 'applied',
      summary: { pulls: 1, newPulls: 1, duplicatePulls: 0 },
    });
    expect(await rowCount(schema.addonEncounterPulls)).toBe(1);
    const again = await apply(token, id, fixture('raid'));
    expect(again.body.summary).toMatchObject({
      newPulls: 0,
      duplicatePulls: 1,
    });
    expect(await rowCount(schema.addonEncounterPulls)).toBe(1);
  });
});

describe('addon import — gating, limits, audit', () => {
  it('another user → 403 and nothing audited against the character', async () => {
    const owner = await memberToken('anaowner');
    const intruder = await memberToken('intruder');
    const id = await createChar(owner);
    const res = await apply(intruder, id, fixture('char-normal'));
    expect(res.status).toBe(403);
    expect(await rowCount(schema.characterAddonSnapshots)).toBe(0);
    expect(await rowCount(schema.addonImportAudit)).toBe(0);
  });

  it('plugin inactive → route refused', async () => {
    const token = await memberToken('anaplugin');
    const id = await createChar(token);
    await testApp.app.get(PluginRegistryService).deactivate('blizzard');
    const res = await post(token, id, fixture('char-normal'));
    expect(res.status).toBe(403);
    expect(await rowCount(schema.addonImportAudit)).toBe(0);
  });

  it('oversized paste → 413 TOO_LARGE (not the schema 400), audited', async () => {
    const token = await memberToken('anabig');
    const id = await createChar(token);
    const res = await post(token, id, `!RL1!char!${'A'.repeat(262_144)}`);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('TOO_LARGE');
    expect((await audits()).map((a) => a.result)).toEqual(['TOO_LARGE']);
  });

  it('21st apply in an hour → 429 RATE_LIMITED; every attempt audited', async () => {
    process.env.THROTTLE_DISABLED = 'false';
    const token = await memberToken('analimit');
    const id = await createChar(token);
    for (let i = 0; i < 20; i++) {
      const res = await apply(token, id, charAt(FIXTURE_EXPORTED_AT + i));
      expect(res.status).toBe(200);
    }
    const limited = await apply(token, id, charAt(FIXTURE_EXPORTED_AT + 99));
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    const preview = await post(token, id, fixture('char-normal'));
    expect(preview.status).toBe(200);
    const rows = await audits();
    expect(rows).toHaveLength(22);
    expect(rows.slice(0, 20).every((r) => r.result === 'applied')).toBe(true);
    expect(rows[20]).toMatchObject({ result: 'RATE_LIMITED', dryRun: false });
    expect(rows[21]).toMatchObject({ result: 'stale', dryRun: true });
  });

  it('every attempt is audited with sha256 + size, never the string', async () => {
    const token = await memberToken('anaaudit');
    const id = await createChar(token, { region: 'eu' });
    const paste = fixture('char-normal');
    await post(token, id, paste);
    await post(token, id, '!RL1!char!AAAA');
    const rows = await audits();
    expect(rows.map((r) => r.result)).toEqual(['REGION_MISMATCH', 'CUT_OFF']);
    expect(rows[0]).toMatchObject({
      characterId: id,
      section: 'char',
      sizeBytes: Buffer.byteLength(paste.trim()),
      dryRun: true,
    });
    expect(rows[0]?.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]).toMatchObject({ section: 'char', payloadSha256: null });
    expect(JSON.stringify(rows)).not.toContain('!RL1!');
  });
});

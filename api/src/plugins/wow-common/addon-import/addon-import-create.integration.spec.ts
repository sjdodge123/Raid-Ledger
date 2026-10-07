/**
 * ROK-1738 — `POST /plugins/wow/characters/addon-import` (no character id)
 * against a real database: create vs update target resolution (D2, ruling
 * Q1), guild/raid-only creates (Q7), export-all in one tx, claim + region
 * rejects, the shared rate budget + audit `character_id`, the GUID-lock
 * serialised double apply (AC8), the ruleset picker (D13) and the Hardcore
 * refusal (A1). Every reject asserts DB row counts, not just the status.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { count, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { AddonWho } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ADDON_IMPORT_APPLY_LIMIT } from './addon-import.audit';
import { GUID_ALREADY_LINKED_MESSAGE } from './addon-import-binding.apply';
import {
  HARDCORE_CREATE_MESSAGE,
  UNSUPPORTED_REGION_MESSAGE,
  UNUSABLE_NAME_MESSAGE,
} from './addon-import-create.helpers';
import {
  FIXTURE_GUID,
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

async function member(username: string) {
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
  return { userId: user.id, token: login.body.access_token as string };
}

/** A hand-made (unpinned) Forever character via the core create route. */
async function handMade(
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

const preview = (token: string, s: string, extra = {}) =>
  testApp.request
    .post('/plugins/wow/characters/addon-import')
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, ...extra });

const applyNew = (token: string, s: string, extra = {}) =>
  preview(token, s, { dryRun: false, ...extra });

const rowCount = async (table: PgTable): Promise<number> => {
  const [row] = await testApp.db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
};

/** Every table the create route can write. */
const written = async () => ({
  characters: await rowCount(schema.characters),
  snapshots: await rowCount(schema.characterAddonSnapshots),
  guilds: await rowCount(schema.guilds),
  pulls: await rowCount(schema.addonEncounterPulls),
});

const NOTHING = { characters: 0, snapshots: 0, guilds: 0, pulls: 0 };

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

const charString = (who: Partial<AddonWho>) =>
  buildImportString(buildCharPayload({ who: buildWho(who) }));

const withRegion = (region: number) =>
  buildImportString({
    ...buildCharPayload(),
    client: { ...buildCharPayload().client, region },
  });

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  // truncateAllTables may wipe `plugins`; re-install, then activate.
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('create route — unpinned char export (AC2)', () => {
  it('dry run → create target, characterId null, nothing written, audited as preview', async () => {
    const { token } = await member('anacreate');
    const res = await preview(token, fixture('char-normal'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('preview');
    expect(res.body.target).toEqual({
      action: 'create',
      characterId: null,
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'normal',
      class: 'Paladin',
      level: 60,
    });
    expect(await written()).toEqual(NOTHING);
    const rows = await audits();
    expect(rows.map((r) => [r.dryRun, r.result, r.characterId])).toEqual([
      [true, 'preview', null],
    ]);
  });

  it('apply → ONE character from the export, GUID pinned, snapshot stored, main (first Forever char)', async () => {
    const { token } = await member('anacreateapply');
    const res = await applyNew(token, fixture('char-normal'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    const id = res.body.target.characterId as string;
    expect(res.body.target).toMatchObject({
      action: 'create',
      ruleset: 'normal',
    });
    expect(await written()).toEqual({
      ...NOTHING,
      characters: 1,
      snapshots: 1,
    });
    expect(await charRow(id)).toMatchObject({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
      level: 60,
      addonGuid: FIXTURE_GUID,
      isMain: true,
    });
  });

  it('apply when the user already has another Forever character → created, NOT main', async () => {
    const { token } = await member('anasecond');
    const bob = await handMade(token, { name: 'Bob Forever' });
    const res = await applyNew(token, fixture('char-normal'));
    expect(res.status).toBe(200);
    const id = res.body.target.characterId as string;
    expect(id).not.toBe(bob);
    expect((await charRow(id)).isMain).toBe(false);
    expect((await charRow(bob)).isMain).toBe(true);
  });
});

describe('create route — guild-only / raid-only paste (AC2b, ruling Q7)', () => {
  it('guild-only paste creates the character from the envelope who, applies the guild, no snapshot', async () => {
    const { token } = await member('anaguildonly');
    const res = await applyNew(token, buildImportString(buildGuildPayload()));
    expect(res.status).toBe(200);
    expect(res.body.target.action).toBe('create');
    const id = res.body.target.characterId as string;
    expect(await written()).toEqual({ ...NOTHING, characters: 1, guilds: 1 });
    expect(await charRow(id)).toMatchObject({
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
      addonGuid: FIXTURE_GUID,
    });
  });

  it('raid-only paste creates the character, applies the pulls, no snapshot', async () => {
    const { token } = await member('anaraidonly');
    const res = await applyNew(token, fixture('raid'));
    expect(res.status).toBe(200);
    const id = res.body.target.characterId as string;
    expect(await written()).toEqual({ ...NOTHING, characters: 1, pulls: 1 });
    expect((await charRow(id)).addonGuid).toBe(FIXTURE_GUID);
  });
});

describe('create route — export-all paste (AC3)', () => {
  it('char + guild + raid all land with the created character in one tx', async () => {
    const { token } = await member('anaall');
    const res = await applyNew(
      token,
      fixture('mixed-char-guild3-raid-shuffled'),
    );
    expect(res.status).toBe(200);
    expect(
      (res.body.sections as Array<{ status: string }>).map((s) => s.status),
    ).toEqual(['applied', 'applied', 'applied']);
    expect(await written()).toEqual({
      characters: 1,
      snapshots: 1,
      guilds: 1,
      pulls: 1,
    });
    expect(await rowCount(schema.guildMembers)).toBe(600);
  });

  it('a guild section rejecting NOT_IN_GUILD rolls back the character creation too', async () => {
    const { token } = await member('anaallreject');
    const who = buildWho({ guid: 'Player-4395-0000BEEF' });
    const paste = [
      { ...buildCharPayload(), who },
      { ...buildGuildPayload(), who },
      { ...buildRaidPayload(), who },
    ]
      .map((p) => buildImportString(p))
      .join('\n');
    const res = await applyNew(token, paste);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_IN_GUILD');
    expect(await written()).toEqual(NOTHING);
    expect(await rowCount(schema.guildMembers)).toBe(0);
  });
});

describe('create route — update targets + GUID holders (AC4, ruling Q1)', () => {
  it('GUID pinned to the importer → update banner, apply writes no new row', async () => {
    const { token } = await member('anapinned');
    const first = await applyNew(token, fixture('char-normal'));
    const id = first.body.target.characterId as string;
    const again = await preview(token, fixture('char-normal'));
    expect(again.status).toBe(200);
    expect(again.body.target).toMatchObject({
      action: 'update',
      characterId: id,
      name: 'Ana Forever',
    });
    const applied = await applyNew(token, fixture('char-normal'));
    expect(applied.status).toBe(200);
    expect(applied.body.target).toMatchObject({
      action: 'update',
      characterId: id,
    });
    expect(await rowCount(schema.characters)).toBe(1);
  });

  it("unpinned GUID + the importer's own hand-made character → update, apply pins the GUID", async () => {
    const { token } = await member('anahandmade');
    const id = await handMade(token);
    const dry = await preview(token, fixture('char-normal'));
    expect(dry.body.target).toMatchObject({
      action: 'update',
      characterId: id,
    });
    expect((await charRow(id)).addonGuid).toBeNull();
    const res = await applyNew(token, fixture('char-normal'));
    expect(res.status).toBe(200);
    expect(res.body.target.characterId).toBe(id);
    expect(await rowCount(schema.characters)).toBe(1);
    expect((await charRow(id)).addonGuid).toBe(FIXTURE_GUID);
  });

  it("GUID pinned to another user's character → 422 linked-elsewhere, nothing written", async () => {
    const owner = await member('anaowner');
    expect((await applyNew(owner.token, fixture('char-normal'))).status).toBe(
      200,
    );
    const before = await written();
    const { token } = await member('anaintruder');
    for (const send of [preview, applyNew]) {
      const res = await send(token, fixture('char-normal'));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'INVALID_PAYLOAD',
        message: GUID_ALREADY_LINKED_MESSAGE,
      });
    }
    expect(await written()).toEqual(before);
  });
});

describe('create route — name claimed by another player (AC5)', () => {
  it('unpinned GUID, name+region owned elsewhere → 422 CHARACTER_CLAIMED, nothing written', async () => {
    const other = await member('anaother');
    await handMade(other.token);
    const { token } = await member('anaclaimer');
    for (const send of [preview, applyNew]) {
      const res = await send(token, fixture('char-normal'));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CHARACTER_CLAIMED');
    }
    expect(await written()).toEqual({ ...NOTHING, characters: 1 });
  });

  it('a conflicting row inserted between preview and apply → CHARACTER_CLAIMED on apply', async () => {
    const { token } = await member('anaracer');
    const dry = await preview(token, fixture('char-normal'));
    expect(dry.body.target.action).toBe('create');
    const other = await member('anasniper');
    await handMade(other.token);
    const res = await applyNew(token, fixture('char-normal'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHARACTER_CLAIMED');
    expect(await written()).toEqual({ ...NOTHING, characters: 1 });
  });

  it('a lost race past the resolver (core create collides) → 422 CHARACTER_CLAIMED, never 500', async () => {
    const other = await member('anaholder');
    await handMade(other.token);
    // Simulate the resolver having read BEFORE the other player's insert.
    const target = jest.requireActual<typeof import('./addon-import.target')>(
      './addon-import.target',
    );
    const spy = jest
      .spyOn(target, 'resolveImportTarget')
      .mockResolvedValue({ action: 'create' });
    const { token } = await member('analoser');
    const res = await applyNew(token, fixture('char-normal'));
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHARACTER_CLAIMED');
    expect(await written()).toEqual({ ...NOTHING, characters: 1 });
  });
});

describe('create route — region (AC6)', () => {
  it('cn (client.region 5) → 422 REGION_MISMATCH, nothing written', async () => {
    const { token } = await member('anacn');
    for (const send of [preview, applyNew]) {
      const res = await send(token, withRegion(5));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'REGION_MISMATCH',
        message: UNSUPPORTED_REGION_MESSAGE,
      });
    }
    expect(await written()).toEqual(NOTHING);
  });

  it('a raw 90 region is refused by the decoder — never a region, nothing written', async () => {
    const { token } = await member('ana90');
    const res = await applyNew(token, withRegion(90));
    expect(res.status).toBe(422);
    expect(res.body.code).not.toBe('REGION_MISMATCH');
    expect(await written()).toEqual(NOTHING);
  });

  it('eu (client.region 3) → the character is created on eu', async () => {
    const { token } = await member('anaeu');
    const res = await applyNew(token, withRegion(3));
    expect(res.status).toBe(200);
    const id = res.body.target.characterId as string;
    expect((await charRow(id)).region).toBe('eu');
  });
});

describe('create route — limits, audit, gating (AC7)', () => {
  it('shares the per-character 20/h apply budget → 429, no character created', async () => {
    process.env.THROTTLE_DISABLED = 'false';
    const { userId, token } = await member('analimit');
    const id = await handMade(token, { name: 'Bob Forever' });
    await testApp.db.insert(schema.addonImportAudit).values(
      Array.from({ length: ADDON_IMPORT_APPLY_LIMIT }, (_, i) => ({
        userId,
        characterId: id,
        sizeBytes: 10,
        dryRun: false,
        result: 'applied',
        createdAt: sql`now() - make_interval(secs => ${i + 1})`,
      })),
    );
    const res = await applyNew(token, fixture('char-normal'));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(await written()).toEqual({ ...NOTHING, characters: 1 });
  });

  it('the apply audit row carries the created character_id, never the raw string', async () => {
    const { token } = await member('anaaudit');
    const s = fixture('char-normal');
    const res = await applyNew(token, s);
    const id = res.body.target.characterId as string;
    const rows = await audits();
    expect(rows.map((r) => [r.dryRun, r.result, r.characterId])).toEqual([
      [false, 'applied', id],
    ]);
    expect(rows[0]?.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('!RL1!');
  });

  it('a reject is audited with its code and a null character_id', async () => {
    const { token } = await member('anaauditreject');
    await applyNew(token, withRegion(5));
    const rows = await audits();
    expect(rows.map((r) => [r.result, r.characterId])).toEqual([
      ['REGION_MISMATCH', null],
    ]);
  });

  it('plugin inactive → route refused, nothing written or audited', async () => {
    const { token } = await member('anaplugin');
    const registry = testApp.app.get(PluginRegistryService);
    await registry.deactivate('blizzard');
    try {
      const res = await applyNew(token, fixture('char-normal'));
      expect(res.status).toBe(403);
      expect(await written()).toEqual(NOTHING);
      expect(await rowCount(schema.addonImportAudit)).toBe(0);
    } finally {
      // Only activate() re-registers the Forever identity adapters.
      await registry.activate('blizzard');
    }
  });
});

describe('create route — concurrent double apply (AC8)', () => {
  it('two parallel applies of one export → exactly one character; the second updates it', async () => {
    const { token } = await member('anadouble');
    const s = fixture('char-normal');
    const [a, b] = await Promise.all([applyNew(token, s), applyNew(token, s)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await rowCount(schema.characters)).toBe(1);
    expect(a.body.target.characterId).toBe(b.body.target.characterId);
    expect([a.body.target.action, b.body.target.action].sort()).toEqual([
      'create',
      'update',
    ]);
  });
});

describe('create route — ruleset picker (AC10, D13)', () => {
  const NULL_RULESET = () => charString({ ruleset: null });

  it('(a) null-ruleset dry run → create target, ruleset null, nothing written', async () => {
    const { token } = await member('anapick');
    const res = await preview(token, NULL_RULESET());
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({
      action: 'create',
      characterId: null,
      ruleset: null,
    });
    expect(await written()).toEqual(NOTHING);
  });

  it('(b) apply without a pick → 422 RULESET_REQUIRED, nothing written, audited', async () => {
    const { token } = await member('anapicknone');
    const res = await applyNew(token, NULL_RULESET());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RULESET_REQUIRED');
    expect(await written()).toEqual(NOTHING);
    const rows = await audits();
    expect(rows.map((r) => r.result)).toEqual(['RULESET_REQUIRED']);
  });

  it("(c) apply with ruleset 'pvp' → created on pvp, GUID pinned", async () => {
    const { token } = await member('anapickpvp');
    const res = await applyNew(token, NULL_RULESET(), { ruleset: 'pvp' });
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({ action: 'create', ruleset: 'pvp' });
    const id = res.body.target.characterId as string;
    expect(await charRow(id)).toMatchObject({
      ruleset: 'pvp',
      addonGuid: FIXTURE_GUID,
    });
  });

  it("(d) the export's ruleset wins over a sent pick", async () => {
    const { token } = await member('anapickignored');
    const res = await applyNew(token, fixture('char-normal'), {
      ruleset: 'pvp',
    });
    expect(res.status).toBe(200);
    const id = res.body.target.characterId as string;
    expect((await charRow(id)).ruleset).toBe('normal');
  });

  it('a sent pick is ignored on an update target', async () => {
    const { token } = await member('anapickupdate');
    const id = await handMade(token);
    const res = await applyNew(token, NULL_RULESET(), { ruleset: 'pvp' });
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({
      action: 'update',
      characterId: id,
      ruleset: 'normal',
    });
    expect((await charRow(id)).ruleset).toBe('normal');
  });

  it('(e) the per-character route still rejects a ruleset key → 400', async () => {
    const { token } = await member('anapickstrict');
    const id = await handMade(token);
    const res = await testApp.request
      .post(`/plugins/wow/characters/${id}/addon-import`)
      .set('Authorization', `Bearer ${token}`)
      .send({ importString: fixture('char-normal'), ruleset: 'pvp' });
    expect(res.status).toBe(400);
    expect(await rowCount(schema.characterAddonSnapshots)).toBe(0);
  });

  it('a Hardcore pick is refused by the strict schema → 400, nothing written', async () => {
    const { token } = await member('anapickhc');
    const res = await applyNew(token, NULL_RULESET(), { ruleset: 'hardcore' });
    expect(res.status).toBe(400);
    expect(await written()).toEqual(NOTHING);
  });
});

describe('create route — Hardcore export (AC11, A1)', () => {
  const HARDCORE = () => charString({ ruleset: 'hardcore' });

  it('create target (dry run + apply) → 422 INVALID_PAYLOAD Hardcore copy, nothing written', async () => {
    const { token } = await member('anahc');
    for (const send of [preview, applyNew]) {
      const res = await send(token, HARDCORE());
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'INVALID_PAYLOAD',
        message: HARDCORE_CREATE_MESSAGE,
      });
    }
    expect(await written()).toEqual(NOTHING);
  });

  it('update target unchanged: a Hardcore export updates the own character (ruleset kept)', async () => {
    const { token } = await member('anahcupdate');
    const id = await handMade(token);
    const dry = await preview(token, HARDCORE());
    expect(dry.status).toBe(200);
    expect(dry.body.target).toMatchObject({
      action: 'update',
      characterId: id,
    });
    const res = await applyNew(token, HARDCORE());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(await rowCount(schema.characters)).toBe(1);
    expect(await charRow(id)).toMatchObject({
      ruleset: 'normal',
      addonGuid: FIXTURE_GUID,
    });
  });
});

describe('create route — a name core would refuse (review MAJOR)', () => {
  it.each([['Ana'], ["D'Arcy Smith"]])(
    '%s: dry run AND apply → 422 INVALID_PAYLOAD, never a code-less 400, nothing written',
    async (fullName) => {
      const { token } = await member('ananame');
      const paste = charString({ fullName, raw: { getUnitName: fullName } });
      for (const send of [preview, applyNew]) {
        const res = await send(token, paste);
        expect([res.status, res.body.code, res.body.message]).toEqual([
          422,
          'INVALID_PAYLOAD',
          UNUSABLE_NAME_MESSAGE,
        ]);
      }
      expect(await written()).toEqual(NOTHING);
      const rows = await audits();
      expect(rows.map((r) => [r.dryRun, r.result])).toEqual([
        [true, 'INVALID_PAYLOAD'],
        [false, 'INVALID_PAYLOAD'],
      ]);
    },
  );
});

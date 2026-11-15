/**
 * ROK-2184 AC 3 — `POST /plugins/wow/characters/:id/addon-import` with a
 * LedgerLink v2 `!RL2!loot!…` paste against a real database. Each drop is
 * stored once in `guild_loot_drops`, de-duplicated across exporters on
 * ruling Q5's key (guild, looterGuid ?? looterName, item, quantity, `at`
 * bucketed to 120 s, instance — NULLS NOT DISTINCT); `newDrops` counts real
 * inserts; a dry run writes nothing and previews the apply's counts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import {
  ADDON_LOOT_DEDUP_BUCKET_SECONDS,
  type AddonLootDrop,
  type AddonWho,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  buildImportString,
  buildWho,
} from './testing/addon-fixture.builder';
import { buildLootDrop, buildLootPayload } from './testing/addon-fixture.loot';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const V2_FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v2/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(V2_FIXTURES, `${name}.txt`), 'utf8');

const BUCKET = ADDON_LOOT_DEDUP_BUCKET_SECONDS;
/** A bucket boundary three days before export: `B + k*BUCKET + s` (s < 120) shares bucket k. */
const B = Math.floor((FIXTURE_EXPORTED_AT - 3 * 86_400) / BUCKET) * BUCKET;
const BOB_GUID = 'Player-4395-0000BEEF';

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
async function memberWithChar(username: string, name: string) {
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
    .send({ gameId, name, class: 'Paladin', region: 'us', ruleset: 'normal' });
  expect(res.status).toBe(201);
  return { userId: user.id, token, charId: res.body.id as string };
}

const ana = () => memberWithChar('lootana', 'Ana Forever');
const bob = () => memberWithChar('lootbob', 'Bob Forever');

const bobWho = (): AddonWho =>
  buildWho({
    guid: BOB_GUID,
    fullName: 'Bob Forever',
    raw: { getUnitName: 'Bob Forever', unitName: ['Bob Forever', null] },
  });

/** `who` with no guild: LedgerLink omits `guildName` for an unguilded exporter. */
function unguilded(who: AddonWho): AddonWho {
  const copy = { ...who };
  delete copy.guildName;
  return copy;
}

/** Drop `i` in bucket `i * 5` at `s` seconds into it (s < 120 stays in the bucket). */
const dropAt = (i: number, s: number, o: Partial<AddonLootDrop> = {}) =>
  buildLootDrop(i, { at: B + i * 5 * BUCKET + s, ...o });

/** A loot paste of `drops`, exported by `who` (Ana by default). */
function lootPaste(drops: AddonLootDrop[], who: AddonWho = buildWho()) {
  return buildImportString({ ...buildLootPayload(drops), who }, { version: 2 });
}

const post = (token: string, charId: string, s: string, dryRun = true) =>
  testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, dryRun });

const lootRows = () =>
  testApp.db
    .select()
    .from(schema.guildLootDrops)
    .orderBy(schema.guildLootDrops.id);

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
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2184 loot import — store once', () => {
  it('the golden !RL2!loot! fixture stores each drop once; a re-import adds nothing', async () => {
    const { userId, token, charId } = await ana();
    const first = await post(token, charId, fixture('loot'), false);
    expect([first.status, first.body.section, first.body.status]).toEqual([
      200,
      'loot',
      'applied',
    ]);
    expect(first.body.summary).toMatchObject({
      drops: 4,
      newDrops: 4,
      duplicateDrops: 0,
    });
    const rows = await lootRows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.guildKey))).toEqual(
      new Set(['night shift']),
    );
    expect(rows.every((r) => r.reportedByUserId === userId)).toBe(true);
    const again = await post(token, charId, fixture('loot'), false);
    expect([again.status, again.body.status]).toEqual([200, 'noop']);
    expect(again.body.summary).toMatchObject({
      newDrops: 0,
      duplicateDrops: 4,
    });
    expect(await lootRows()).toHaveLength(4);
    const audit = await testApp.db
      .select()
      .from(schema.addonImportAudit)
      .orderBy(schema.addonImportAudit.id);
    expect(audit.map((r) => [r.section, r.result])).toEqual([
      ['loot', 'applied'],
      ['loot', 'noop'],
    ]);
  });

  it('a dry run stores nothing and previews exactly the counts the apply then reports', async () => {
    const { token, charId } = await ana();
    expect(
      (
        await post(
          token,
          charId,
          lootPaste([dropAt(0, 5), dropAt(1, 5)]),
          false,
        )
      ).status,
    ).toBe(200);
    const window = lootPaste([0, 1, 2, 3].map((i) => dropAt(i, 30)));
    const preview = await post(token, charId, window, true);
    expect([preview.status, preview.body.status]).toEqual([200, 'preview']);
    expect(preview.body.summary).toMatchObject({
      drops: 4,
      newDrops: 2,
      duplicateDrops: 2,
    });
    expect(await lootRows()).toHaveLength(2);
    const applied = await post(token, charId, window, false);
    expect(applied.body.summary).toEqual(preview.body.summary);
    expect(await lootRows()).toHaveLength(4);
  });
});

describe('ROK-2184 loot import — two exporters, overlapping windows', () => {
  it('the second exporter adds only the new drops; the first reporter keeps the overlap', async () => {
    const a = await ana();
    const b = await bob();
    const aPaste = lootPaste([0, 1, 2, 3].map((i) => dropAt(i, 5)));
    expect((await post(a.token, a.charId, aPaste, false)).status).toBe(200);
    // Bob saw drops 2–5, each `at` 110 s later but inside the same bucket.
    const bPaste = lootPaste(
      [2, 3, 4, 5].map((i) => dropAt(i, 115)),
      bobWho(),
    );
    const res = await post(b.token, b.charId, bPaste, false);
    expect([res.status, res.body.status]).toEqual([200, 'applied']);
    expect(res.body.summary).toMatchObject({
      drops: 4,
      newDrops: 2,
      duplicateDrops: 2,
    });
    const rows = await lootRows();
    expect(rows.map((r) => [r.itemId, r.reportedByUserId])).toEqual([
      [16800, a.userId],
      [16801, a.userId],
      [16802, a.userId],
      [16803, a.userId],
      [16804, b.userId],
      [16805, b.userId],
    ]);
  });

  it('the same drop across a bucket boundary is two rows (Q5 bucket, accepted)', async () => {
    const a = await ana();
    const b = await bob();
    await post(a.token, a.charId, lootPaste([dropAt(0, 115)]), false);
    const res = await post(
      b.token,
      b.charId,
      lootPaste([dropAt(0, BUCKET + 5)], bobWho()),
      false,
    );
    expect(res.body.summary).toMatchObject({ newDrops: 1 });
    expect((await lootRows()).map((r) => r.atBucket)).toEqual([
      B / BUCKET,
      B / BUCKET + 1,
    ]);
  });

  it('looter key: same GUID under another name dedups; the name without a GUID is a new row (known)', async () => {
    const a = await ana();
    const b = await bob();
    // Drop 0's looter is Ana with her GUID (`buildLootDrop` even index).
    await post(a.token, a.charId, lootPaste([dropAt(0, 5)]), false);
    const renamed = dropAt(0, 20, { looterName: 'Ana Forever-Testrealm' });
    const sameGuid = await post(
      b.token,
      b.charId,
      lootPaste([renamed], bobWho()),
      false,
    );
    expect(sameGuid.body.summary).toMatchObject({ newDrops: 0 });
    const noGuid = { ...dropAt(0, 40) };
    delete noGuid.looterGuid;
    const byName = await post(
      b.token,
      b.charId,
      lootPaste([noGuid], bobWho()),
      false,
    );
    expect(byName.body.summary).toMatchObject({ newDrops: 1 });
    expect((await lootRows()).map((r) => r.looterKey)).toEqual([
      'Player-4395-0ABCDEF0',
      'Ana Forever',
    ]);
  });

  it('a drop with no instanceId still dedups (NULLS NOT DISTINCT)', async () => {
    const a = await ana();
    const b = await bob();
    const trash = (s: number): AddonLootDrop => ({
      at: B + s,
      itemId: 12360,
      quantity: 3,
      looterName: 'Lootera',
      method: 'direct',
    });
    await post(a.token, a.charId, lootPaste([trash(5)]), false);
    const res = await post(
      b.token,
      b.charId,
      lootPaste([trash(60)], bobWho()),
      false,
    );
    expect([res.status, res.body.status]).toEqual([200, 'noop']);
    expect(res.body.summary).toMatchObject({ newDrops: 0, duplicateDrops: 1 });
    const rows = await lootRows();
    expect(rows.map((r) => [r.itemId, r.instanceId])).toEqual([[12360, null]]);
  });
});

describe('ROK-2184 loot import — guild scope', () => {
  it("an unguilded paste stores under the '' key, dedups there, and never merges with a guild's drops", async () => {
    const a = await ana();
    const b = await bob();
    const drop = dropAt(0, 5);
    const solo = await post(
      a.token,
      a.charId,
      lootPaste([drop], unguilded(buildWho())),
      false,
    );
    expect([solo.status, solo.body.status]).toEqual([200, 'applied']);
    const soloAgain = await post(
      b.token,
      b.charId,
      lootPaste([dropAt(0, 50)], unguilded(bobWho())),
      false,
    );
    expect(soloAgain.body.summary).toMatchObject({ newDrops: 0 });
    const guilded = await post(a.token, a.charId, lootPaste([drop]), false);
    expect(guilded.body.summary).toMatchObject({ newDrops: 1 });
    expect((await lootRows()).map((r) => r.guildKey)).toEqual([
      '',
      'night shift',
    ]);
  });

  it.each([
    ['one guild (serialised on the guild-import lock)', false],
    ['unguilded (no lock — the unique index alone)', true],
  ])(
    'two concurrent imports of overlapping windows store each drop once — %s',
    async (_label, solo) => {
      const a = await ana();
      const b = await bob();
      const aWho = solo ? unguilded(buildWho()) : buildWho();
      const bWho = solo ? unguilded(bobWho()) : bobWho();
      const [ra, rb] = await Promise.all([
        post(
          a.token,
          a.charId,
          lootPaste(
            [0, 1, 2, 3].map((i) => dropAt(i, 5)),
            aWho,
          ),
          false,
        ),
        post(
          b.token,
          b.charId,
          lootPaste(
            [2, 3, 4, 5].map((i) => dropAt(i, 90)),
            bWho,
          ),
          false,
        ),
      ]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const rows = await lootRows();
      expect(rows.map((r) => r.itemId).sort()).toEqual([
        16800, 16801, 16802, 16803, 16804, 16805,
      ]);
      const inserted =
        Number(ra.body.summary.newDrops) + Number(rb.body.summary.newDrops);
      expect(inserted).toBe(6);
    },
  );
});

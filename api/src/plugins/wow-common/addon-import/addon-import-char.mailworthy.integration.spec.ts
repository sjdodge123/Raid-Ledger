/**
 * ROK-2148 D.2 — a LedgerLink char export's Mailworthy block lands on its
 * guild's template / peers / givers (spec T12–T20, amended T15). Harness
 * copied from `addon-import-guild-game-text.integration.spec.ts`.
 */
import * as bcrypt from 'bcrypt';
import { asc, eq } from 'drizzle-orm';
import type {
  AddonCharExport,
  AddonMailworthy,
  AddonMailworthyGiver,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildWho,
} from './testing/addon-fixture.builder';
import {
  MAILWORTHY_GENERATED_AT,
  MAILWORTHY_TEMPLATE_REV,
  MAILWORTHY_TODAY,
  buildCharMailworthyPayload,
  buildMailworthyBlock,
  buildMailworthyTemplate,
} from './testing/addon-fixture.mailworthy';
import { FIXTURE_NOW_MS, pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const { guildMailworthyGivers: givers, guildMailworthyPeers: peers } = schema;
const ANABELLE = buildMember(5, { name: 'Anabelle Forever' });
const ROSTER = [
  buildMember(0xabcdef0, { name: 'Ana Forever' }),
  buildMember(1, { rankIndex: 1 }),
  buildMember(2),
  buildMember(3),
  buildMember(4),
  ANABELLE,
];

let testApp: TestApp;
let gameId: number;
let token: string;
let charId: string;
/** The exporter's alt on the same account (pinned to ANABELLE's GUID). */
let altCharId: string;

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

/** A character for `owner`, optionally pinned to a roster GUID. */
async function createChar(owner: string, name: string, guid?: string) {
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${owner}`)
    .send({ gameId, name, class: 'Paladin', region: 'us', ruleset: 'normal' });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  if (guid) {
    await testApp.db
      .update(schema.characters)
      .set({ addonGuid: guid })
      .where(eq(schema.characters.id, id));
  }
  return id;
}

async function importString(s: string, dryRun = false): Promise<number> {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, dryRun });
  return res.status;
}

const importBlock = (block: AddonMailworthy, dryRun = false) =>
  importString(buildImportString(buildCharMailworthyPayload(block)), dryRun);

/** Apply a char export; the 200 body's status + summary.mailworthy (Q8). */
async function importOutcome(payload: AddonCharExport, onChar = charId) {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${onChar}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: buildImportString(payload), dryRun: false });
  expect(res.status).toBe(200);
  const body = res.body as {
    status: string;
    summary: { mailworthy?: unknown };
  };
  return { status: body.status, mailworthy: body.summary.mailworthy };
}

async function guildId(): Promise<number> {
  const [g] = nonEmpty(await testApp.db.select().from(schema.guilds), 'guild');
  return g.id;
}

async function giverRows() {
  return testApp.db.select().from(givers).orderBy(asc(givers.nameKey));
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** Seed one stored giver row (bypasses the apply). */
async function seedGiver(
  name: string,
  source: 'self' | 'relayed',
  asOf: number,
  generatedAt: number,
) {
  await testApp.db.insert(givers).values({
    guildId: await guildId(),
    nameKey: name.toLowerCase(),
    characterName: name,
    itemsAllTime: 999,
    countingSince: new Date(asOf * 1000),
    days: [],
    asOf: new Date(asOf * 1000),
    generatedAt: new Date(generatedAt * 1000),
    source,
  });
}

const giver = (over: Partial<AddonMailworthyGiver>): AddonMailworthyGiver => ({
  characterName: 'Ana Forever',
  itemsAllTime: 10,
  countingSince: FIXTURE_EXPORTED_AT - 86_400,
  asOf: MAILWORTHY_GENERATED_AT,
  days: [{ day: MAILWORTHY_TODAY, items: 10 }],
  ...over,
});

const block = (g: AddonMailworthyGiver[]): AddonMailworthy => ({
  generatedAt: MAILWORTHY_GENERATED_AT,
  givers: g,
});

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  token = await memberToken('mwexporter');
  charId = await createChar(token, 'Ana Forever');
  altCharId = await createChar(token, 'Anabelle Forever', ANABELLE.guid);
  const other = await memberToken('mwother');
  await createChar(other, 'Member2', buildMember(2).guid);
  expect(await importString(buildImportString(buildGuildPayload(ROSTER)))).toBe(
    200,
  );
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2148 — Mailworthy block apply', () => {
  it('stores template, peers and givers with their source', async () => {
    expect(await importBlock(buildMailworthyBlock())).toBe(200);
    const [tpl] = await testApp.db
      .select()
      .from(schema.guildMailworthyTemplates);
    expect([tpl?.rev, tpl?.authorName, tpl?.rules.length]).toEqual([
      MAILWORTHY_TEMPLATE_REV,
      'Member1',
      3,
    ]);
    const rows = await giverRows();
    expect(
      rows.map((r) => [r.characterName, r.source, r.itemsAllTime]),
    ).toEqual([
      ['Ana Forever', 'self', 140],
      ['Anabelle Forever', 'self', 20],
      ['Member2', 'relayed', 64],
    ]);
    const member2 = rows.find((r) => r.nameKey === 'member2');
    expect(member2?.asOf.toISOString()).toBe(
      iso(MAILWORTHY_GENERATED_AT - 7_200),
    );
    const peerKeys = (await testApp.db.select().from(peers)).map(
      (p) => p.nameKey,
    );
    expect(peerKeys.sort()).toEqual([
      'ana forever',
      'anabelle forever',
      'member1',
      'member2',
      'member3',
      'member4',
    ]);
  });

  it('an import without the block writes nothing Mailworthy', async () => {
    expect(await importString(buildImportString(buildCharPayload()))).toBe(200);
    expect(await giverRows()).toEqual([]);
    expect(await testApp.db.select().from(peers)).toEqual([]);
    expect(
      await testApp.db.select().from(schema.guildMailworthyTemplates),
    ).toEqual([]);
  });

  it('a dry run writes nothing (T20)', async () => {
    expect(await importBlock(buildMailworthyBlock(), true)).toBe(200);
    expect(await giverRows()).toEqual([]);
  });

  it('an exporter missing from the latest roster writes nothing (T16)', async () => {
    await testApp.db
      .update(schema.guildMembers)
      .set({ guid: 'Player-4395-FFFFFFFF' })
      .where(eq(schema.guildMembers.guid, buildMember(0xabcdef0).guid));
    expect(await importBlock(buildMailworthyBlock())).toBe(200);
    expect(await giverRows()).toEqual([]);
  });
});

describe('ROK-2148 — Mailworthy givers: dedupe, clamp, tie-break', () => {
  it('dedupes givers by newest asOf and clamps all-time to the days (T11)', async () => {
    const d = MAILWORTHY_TODAY;
    await importBlock(
      block([
        giver({ itemsAllTime: 1, asOf: MAILWORTHY_GENERATED_AT - 60 }),
        giver({
          characterName: ' ana forever ',
          itemsAllTime: 5,
          days: [
            { day: d, items: 3 },
            { day: d - 1, items: 6 },
            { day: d, items: 4 },
          ],
        }),
        giver({ characterName: 'Stranger' }),
      ]),
    );
    const rows = await giverRows();
    expect(rows.map((r) => [r.nameKey, r.itemsAllTime, r.days])).toEqual([
      [
        'ana forever',
        10,
        [
          { day: d - 1, items: 6 },
          { day: d, items: 4 },
        ],
      ],
    ]);
  });

  it('same source: older asOf never replaces; an asOf tie goes to the later export (T18)', async () => {
    const at = MAILWORTHY_GENERATED_AT;
    // countingSince varies only so each import string is distinct.
    const once = (i: number) =>
      importBlock(block([giver({ countingSince: at - 86_400 - i })]));
    await seedGiver('Ana Forever', 'self', at + 60, at);
    await once(1);
    expect((await giverRows())[0]?.itemsAllTime).toBe(999);
    await testApp.db.delete(givers);
    await seedGiver('Ana Forever', 'self', at, at + 30);
    await once(2);
    expect((await giverRows())[0]?.itemsAllTime).toBe(999);
    await testApp.db.delete(givers);
    await seedGiver('Ana Forever', 'self', at, at - 30);
    await once(3);
    expect((await giverRows())[0]?.itemsAllTime).toBe(10);
  });
});

describe('ROK-2148 — Mailworthy givers: self / relayed precedence (amended D5)', () => {
  it('relayed never replaces self, even with a newer asOf (amended T15)', async () => {
    await seedGiver('Member2', 'self', MAILWORTHY_GENERATED_AT - 86_400, 0);
    await importBlock(block([giver({ characterName: 'Member2' })]));
    const [row] = await giverRows();
    expect([row?.source, row?.itemsAllTime]).toEqual(['self', 999]);
  });

  it('relayed replaces relayed when newer (amended T15)', async () => {
    await seedGiver('Member2', 'relayed', MAILWORTHY_GENERATED_AT - 86_400, 0);
    await importBlock(block([giver({ characterName: 'Member2' })]));
    const [row] = await giverRows();
    expect([row?.source, row?.itemsAllTime]).toEqual(['relayed', 10]);
  });

  it('self always replaces relayed, even an older asOf (amended T15)', async () => {
    const at = MAILWORTHY_GENERATED_AT;
    await seedGiver('Anabelle Forever', 'relayed', at + 600, at + 600);
    await importBlock(block([giver({ characterName: 'Anabelle Forever' })]));
    const [row] = await giverRows();
    expect([row?.source, row?.itemsAllTime, row?.asOf.toISOString()]).toEqual([
      'self',
      10,
      iso(at),
    ]);
  });
});

describe('ROK-2148 — Mailworthy template and peers', () => {
  it('template: lower rev, rank-3 author and a future rev are refused (T12–T13)', async () => {
    await importBlock(buildMailworthyBlock());
    const base = buildMailworthyTemplate();
    const nowS = FIXTURE_NOW_MS / 1000;
    const tries = [
      { ...base, rev: MAILWORTHY_TEMPLATE_REV - 1, author: 'Member1' },
      { ...base, rev: MAILWORTHY_TEMPLATE_REV + 1, author: 'Member3' },
      { ...base, rev: nowS + 601, author: 'Member1' },
    ];
    for (const template of tries) {
      await importBlock({ generatedAt: MAILWORTHY_GENERATED_AT, template });
    }
    const [tpl] = await testApp.db
      .select()
      .from(schema.guildMailworthyTemplates);
    expect(tpl?.rev).toBe(MAILWORTHY_TEMPLATE_REV);
    const newer = { ...base, rev: MAILWORTHY_TEMPLATE_REV + 1, rules: [] };
    await importBlock({
      generatedAt: MAILWORTHY_GENERATED_AT,
      template: newer,
    });
    const [after] = await testApp.db
      .select()
      .from(schema.guildMailworthyTemplates);
    expect([after?.rev, after?.rules]).toEqual([
      MAILWORTHY_TEMPLATE_REV + 1,
      [],
    ]);
  });

  it('peers keep the GREATEST last_seen_at; 90-day-old peers are pruned (T19)', async () => {
    const later = new Date(FIXTURE_NOW_MS - 60_000);
    const old = new Date(FIXTURE_NOW_MS - 91 * 86_400_000);
    const id = await guildId();
    await testApp.db.insert(peers).values([
      { guildId: id, nameKey: 'member4', name: 'Member4', lastSeenAt: later },
      { guildId: id, nameKey: 'oldie', name: 'Oldie', lastSeenAt: old },
    ]);
    await importBlock(buildMailworthyBlock());
    const rows = await testApp.db.select().from(peers);
    const m4 = rows.find((p) => p.nameKey === 'member4');
    expect(m4?.lastSeenAt.toISOString()).toBe(later.toISOString());
    expect(rows.some((p) => p.nameKey === 'oldie')).toBe(false);
  });
});

describe('ROK-2148 — Mailworthy on a stale char export (T17)', () => {
  it('a char export older than the stored snapshot still updates givers', async () => {
    const newer = buildCharPayload({ exportedAt: FIXTURE_EXPORTED_AT + 600 });
    expect((await importOutcome(newer)).status).toBe('applied');
    const at = MAILWORTHY_GENERATED_AT;
    await seedGiver('Ana Forever', 'self', at - 86_400, at - 86_400);
    const res = await importOutcome(
      buildCharMailworthyPayload(block([giver({})])),
    );
    expect(res.status).toBe('stale');
    const [row] = await giverRows();
    expect([row?.itemsAllTime, row?.asOf.toISOString()]).toEqual([10, iso(at)]);
    expect(res.mailworthy).toMatchObject({ status: 'applied', givers: 1 });
  });
});

describe('ROK-2148 Q8 — the char summary reports the Mailworthy block', () => {
  it('applied: givers / rejected / peers / template counts', async () => {
    const res = await importOutcome(buildCharMailworthyPayload());
    expect(res.mailworthy).toEqual({
      status: 'applied',
      givers: 3,
      giversRejected: 0,
      peers: 6,
      template: 'stored',
    });
  });

  it('applied with a rejected giver and no template', async () => {
    const two = block([giver({}), giver({ characterName: 'Stranger' })]);
    const res = await importOutcome(buildCharMailworthyPayload(two));
    expect(res.mailworthy).toEqual({
      status: 'applied',
      givers: 1,
      giversRejected: 1,
      peers: 1,
      template: 'none',
    });
  });

  it('skipped: every giver off the roster', async () => {
    const off = block([giver({ characterName: 'Stranger' })]);
    const res = await importOutcome(buildCharMailworthyPayload(off));
    expect(res.mailworthy).toEqual({
      status: 'skipped',
      reason: 'givers_rejected',
    });
  });

  it('skipped: exporter not on the latest roster', async () => {
    await testApp.db
      .update(schema.guildMembers)
      .set({ guid: 'Player-4395-FFFFFFFF' })
      .where(eq(schema.guildMembers.guid, buildMember(0xabcdef0).guid));
    const res = await importOutcome(buildCharMailworthyPayload());
    expect(res.mailworthy).toEqual({
      status: 'skipped',
      reason: 'not_on_roster',
    });
  });

  it('skipped: the export names a guild Raid Ledger does not have', async () => {
    const p = buildCharMailworthyPayload();
    const res = await importOutcome({
      ...p,
      who: { ...p.who, guildName: 'Nowhere Guild' },
    });
    expect(res.mailworthy).toEqual({
      status: 'skipped',
      reason: 'guild_unresolved',
    });
  });

  it('absent when the export carries no block', async () => {
    const res = await importOutcome(buildCharPayload());
    expect(res.mailworthy).toBeUndefined();
  });
});

/** The full block exported by the alt (Anabelle) instead of Ana. */
function altMailworthyPayload(): AddonCharExport {
  const name = 'Anabelle Forever';
  return {
    ...buildCharMailworthyPayload(),
    who: buildWho({
      guid: ANABELLE.guid,
      fullName: name,
      raw: { getUnitName: name, unitName: [name, null] },
    }),
  };
}

describe('ROK-2148 review r1 — exporter name, re-imports, alts', () => {
  it("the exporter's peer row drops a -Realm suffix from who.fullName", async () => {
    const payload = buildCharMailworthyPayload(
      block([giver({ characterName: 'Member2' })]),
    );
    const realmed = {
      ...payload,
      who: buildWho({ fullName: 'Ana Forever-Doomhowl' }),
    };
    expect((await importOutcome(realmed)).status).toBe('applied');
    const keys = (await testApp.db.select().from(peers)).map((p) => p.nameKey);
    expect(keys.sort()).toEqual(['ana forever', 'member2']);
  });

  it('counts only the giver rows actually written (a refused older report is 0)', async () => {
    const at = MAILWORTHY_GENERATED_AT;
    await seedGiver('Ana Forever', 'self', at + 60, at);
    const res = await importOutcome(
      buildCharMailworthyPayload(block([giver({})])),
    );
    expect(res.mailworthy).toMatchObject({
      status: 'applied',
      givers: 0,
      giversRejected: 0,
    });
    expect((await giverRows())[0]?.itemsAllTime).toBe(999);
  });

  it('two alts of one account importing the same block keep one row per giver (T14)', async () => {
    const first = await importOutcome(buildCharMailworthyPayload());
    const alt = altMailworthyPayload();
    const second = await importOutcome(alt, altCharId);
    expect([first.status, second.status]).toEqual(['applied', 'applied']);
    const rows = await giverRows();
    expect(
      rows.map((r) => [r.characterName, r.source, r.itemsAllTime]),
    ).toEqual([
      ['Ana Forever', 'self', 140],
      ['Anabelle Forever', 'self', 20],
      ['Member2', 'relayed', 64],
    ]);
    const peerKeys = (await testApp.db.select().from(peers)).map(
      (p) => p.nameKey,
    );
    expect(peerKeys.sort()).toEqual([
      'ana forever',
      'anabelle forever',
      'member1',
      'member2',
      'member3',
      'member4',
    ]);
  });
});

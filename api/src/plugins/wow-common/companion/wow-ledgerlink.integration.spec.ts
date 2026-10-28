/**
 * ROK-1964 §6.4 — `wow-ledgerlink` companion messages against a real DB. The
 * production `WowLedgerlinkHandler` is registered by `WowCommonModule`;
 * nothing here stubs it. A device posts to `/companion/v1/messages/
 * wow-ledgerlink` and the export goes through the paste import (`importNew`,
 * `dryRun: false`) as the device's user: same rows as a paste, noop by sha on
 * a replay, stale on an older export, rejects as pinned companion codes with
 * nothing written, device auth and plugin gating from the ingest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  COMPANION_MESSAGE_MAX_BYTES,
  WOW_LEDGERLINK_CONTRACT_ID,
  WowLedgerlinkMessageSchema,
  type WowLedgerlinkMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
} from '../../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  buildCharPayload,
  buildImportString,
  buildWho,
} from '../addon-import/testing/addon-fixture.builder';
import { pinExportClock } from '../addon-import/testing/pin-export-clock';
import { WOW_LEDGERLINK_EXPORT_PATH } from './wow-ledgerlink.errors';

pinExportClock();

const MESSAGES = `/companion/v1/messages/${WOW_LEDGERLINK_CONTRACT_ID}`;
const PASTE = '/plugins/wow/characters/addon-import';
const FOREVER_SLUG = 'world-of-warcraft-forever';
const ROOT = join(__dirname, '../../../../../packages/contract');
const LEDGERLINK = join(ROOT, 'ledgerlink/v1/fixtures');
const COMPANION = join(ROOT, 'companion/wow-ledgerlink/v1/fixtures');
/** Fixed and past: the fixtures' own capturedAt can be ahead of a run. */
const CAPTURED = '2026-09-22T00:00:00Z';

const pasteFixture = (name: string): string =>
  readFileSync(join(LEDGERLINK, `${name}.txt`), 'utf8');
const rawCompanion = (name: string): unknown =>
  JSON.parse(readFileSync(join(COMPANION, `${name}.json`), 'utf8')) as unknown;
const companionFixture = (name: string): WowLedgerlinkMessage => ({
  ...WowLedgerlinkMessageSchema.parse(rawCompanion(name)),
  capturedAt: CAPTURED,
});

/** A message wrapping `exportString` (envelope from the char fixture). */
const message = (exportString: string): WowLedgerlinkMessage => ({
  ...companionFixture('char-normal'),
  payload: { exportString },
});

let testApp: TestApp;
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

/** The Forever game's id in the CURRENT seed (serials move per truncate). */
async function foreverGameId(): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.slug, FOREVER_SLUG))
      .limit(1),
    'forever game',
  );
  return row.id;
}

async function ensureGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db
    .insert(schema.games)
    .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG });
}

async function setup(): Promise<void> {
  expireLimiterWindows(testApp);
  await ensureGame();
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(setup);

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A user, their session JWT and a linked device's `rlcd_` token. */
async function member(name: string) {
  const user = await makeUser(testApp, name);
  const device = await linkDevice(testApp, user.token);
  return { id: user.id, session: user.token, ...device };
}

const post = (token: string, body: unknown) =>
  testApp.request
    .post(MESSAGES)
    .set(bearer(token))
    .send(body as object);

const rowCount = async (table: PgTable): Promise<number> => {
  const [row] = await testApp.db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
};

const written = async () => ({
  characters: await rowCount(schema.characters),
  snapshots: await rowCount(schema.characterAddonSnapshots),
  guilds: await rowCount(schema.guilds),
  pulls: await rowCount(schema.addonEncounterPulls),
});
const NOTHING = { characters: 0, snapshots: 0, guilds: 0, pulls: 0 };

const auditResults = async (): Promise<string[]> =>
  (
    await testApp.db
      .select({ result: schema.addonImportAudit.result })
      .from(schema.addonImportAudit)
      .orderBy(schema.addonImportAudit.id)
  ).map((r) => r.result);

const snapshots = () =>
  testApp.db
    .select()
    .from(schema.characterAddonSnapshots)
    .orderBy(schema.characterAddonSnapshots.id);

/** `row` without `keys` (owner, ids, write timestamps). */
function omit<T extends object>(row: T, keys: readonly string[]) {
  return Object.fromEntries(
    Object.entries(row).filter(([k]) => !keys.includes(k)),
  );
}

/**
 * Character + snapshot rows minus owner, ids and write timestamps. `gameId`
 * is a serial: `truncateAllTables` DELETEs without resetting identities, so
 * the reseeded Forever game gets a new id — each side asserts its own
 * character landed on the Forever game instead.
 */
async function importedState() {
  const chars = await testApp.db.select().from(schema.characters);
  const snaps = await snapshots();
  return {
    characters: chars.map((c) =>
      omit(c, ['id', 'userId', 'gameId', 'createdAt', 'updatedAt']),
    ),
    snapshots: snaps.map((s) => omit(s, ['id', 'characterId', 'importedAt'])),
  };
}

function expectAccepted(res: { status: number; body: unknown }): void {
  expect({ status: res.status, body: res.body }).toEqual({
    status: 202,
    body: { status: 'accepted' },
  });
}

function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect({
    status: res.status,
    code: (res.body as { code?: string }).code,
  }).toEqual({ status, code });
}

describe('collector message → same result as a paste (AC)', () => {
  it('the companion fixture wraps the paste fixture verbatim', () => {
    expect(companionFixture('char-normal').payload.exportString).toBe(
      pasteFixture('char-normal'),
    );
  });

  it("user A's device message and user B's paste write identical character + snapshot rows", async () => {
    const a = await member('ll-collector');
    expectAccepted(await post(a.token, companionFixture('char-normal')));
    const [charA] = nonEmpty(
      await testApp.db.select().from(schema.characters),
      'collector character',
    );
    expect(charA).toMatchObject({
      userId: a.id,
      name: 'Ana Forever',
      gameId: await foreverGameId(),
    });
    const viaCompanion = await importedState();
    expect(viaCompanion.snapshots).toHaveLength(1);

    testApp.seed = await truncateAllTables(testApp.db);
    await setup();
    const b = await makeUser(testApp, 'll-paster');
    const paste = await testApp.request
      .post(PASTE)
      .set(bearer(b.token))
      .send({ importString: pasteFixture('char-normal'), dryRun: false });
    expect({ status: paste.status, result: paste.body.status }).toEqual({
      status: 200,
      result: 'applied',
    });
    const [charB] = nonEmpty(
      await testApp.db.select().from(schema.characters),
      'pasted character',
    );
    expect(charB).toMatchObject({
      userId: b.id,
      gameId: await foreverGameId(),
    });
    expect(await importedState()).toEqual(viaCompanion);
  });
});

describe('sections, replays and staleness', () => {
  it('mixed char + guild (3 pages) + raid in one message → all three sections applied', async () => {
    const a = await member('ll-mixed');
    const res = await post(
      a.token,
      companionFixture('mixed-char-guild3-raid-shuffled'),
    );
    expectAccepted(res);
    expect(await written()).toEqual({
      characters: 1,
      snapshots: 1,
      guilds: 1,
      pulls: 1,
    });
    expect(await rowCount(schema.guildMembers)).toBe(600);
  });

  it('a guild-only export (3 pages) creates the character from the envelope and applies the guild', async () => {
    const a = await member('ll-guild');
    expectAccepted(await post(a.token, companionFixture('guild-3-pages')));
    expect(await written()).toEqual({ ...NOTHING, characters: 1, guilds: 1 });
  });

  it('the same message again → 202 accepted, import noop, no new snapshot row', async () => {
    const a = await member('ll-replay');
    const msg = companionFixture('char-normal');
    expectAccepted(await post(a.token, msg));
    const before = await snapshots();
    expectAccepted(await post(a.token, msg));
    expect(await snapshots()).toEqual(before);
    expect(await auditResults()).toEqual(['applied', 'noop']);
  });

  it('an older export after a newer one → 202 accepted, import stale, stored snapshot unchanged', async () => {
    const a = await member('ll-stale');
    const at = (exportedAt: number) =>
      message(buildImportString(buildCharPayload({ exportedAt })));
    expectAccepted(await post(a.token, at(FIXTURE_EXPORTED_AT + 600)));
    const before = await snapshots();
    expect(before).toHaveLength(1);
    expectAccepted(await post(a.token, at(FIXTURE_EXPORTED_AT)));
    expect(await snapshots()).toEqual(before);
    expect(await auditResults()).toEqual(['applied', 'stale']);
  });
});

describe('rejects → pinned companion codes, nothing written', () => {
  it('a malformed export string → 400 invalid_payload with the addon code, never the string', async () => {
    const a = await member('ll-malformed');
    const res = await post(a.token, message('not an import string'));
    expectError(res, 400, 'invalid_payload');
    expect(res.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'BAD_HEADER' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('not an import string');
    expect(await written()).toEqual(NOTHING);
  });

  it('a whitespace-only export string → 400 invalid_payload INVALID_PAYLOAD, nothing written', async () => {
    const a = await member('ll-blank');
    const res = await post(a.token, message('   \n\t  '));
    expectError(res, 400, 'invalid_payload');
    expect(res.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'INVALID_PAYLOAD' },
    ]);
    expect(await written()).toEqual(NOTHING);
  });

  it('D2/Q6 pinned: a create from an export with no ruleset → 400 invalid_payload RULESET_REQUIRED, nothing written', async () => {
    const a = await member('ll-noruleset');
    const noRuleset = buildCharPayload({ who: buildWho({ ruleset: null }) });
    const res = await post(a.token, message(buildImportString(noRuleset)));
    expectError(res, 400, 'invalid_payload');
    expect(res.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'RULESET_REQUIRED' },
    ]);
    expect(await written()).toEqual(NOTHING);
    expect(await auditResults()).toEqual(['RULESET_REQUIRED']);
  });

  it('an export over the contract cap → 400 invalid_payload too_big (never imported)', async () => {
    const a = await member('ll-overcap');
    const raw = rawCompanion('invalid/export-over-cap') as object;
    const res = await post(a.token, { ...raw, capturedAt: CAPTURED });
    expectError(res, 400, 'invalid_payload');
    expect(res.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'too_big' },
    ]);
    expect(await auditResults()).toEqual([]);
  });

  it(`a body over ${COMPANION_MESSAGE_MAX_BYTES} bytes → 413 payload_too_large`, async () => {
    const a = await member('ll-toolarge');
    const huge = message('x'.repeat(COMPANION_MESSAGE_MAX_BYTES + 1));
    expectError(await post(a.token, huge), 413, 'payload_too_large');
    expect(await auditResults()).toEqual([]);
  });
});

describe('auth and plugin gating', () => {
  it('a revoked device → 401 unauthorized, nothing written', async () => {
    const a = await member('ll-revoked');
    const del = await testApp.request
      .delete(`/companion/v1/devices/${a.deviceId}`)
      .set(bearer(a.session));
    expect(del.status).toBe(204);
    const res = await post(a.token, companionFixture('char-normal'));
    expectError(res, 401, 'unauthorized');
    expect(await written()).toEqual(NOTHING);
  });

  it('a token no device holds → 401 unauthorized', async () => {
    const res = await post(
      'rlcd_notalinkeddevicetoken000000000000000000',
      companionFixture('char-normal'),
    );
    expectError(res, 401, 'unauthorized');
  });

  it('a session JWT → 404 unknown_contract (device-only handler)', async () => {
    const a = await member('ll-session');
    const res = await post(a.session, companionFixture('char-normal'));
    expectError(res, 404, 'unknown_contract');
    expect(await written()).toEqual(NOTHING);
  });

  it('blizzard inactive → 404 unknown_contract, nothing written or audited', async () => {
    const a = await member('ll-inactive');
    await plugins().deactivate('blizzard');
    try {
      const res = await post(a.token, companionFixture('char-normal'));
      expectError(res, 404, 'unknown_contract');
      expect(await written()).toEqual(NOTHING);
      expect(await auditResults()).toEqual([]);
    } finally {
      // deactivate() drops the Forever identity provider (ROK-1733); only
      // activate() re-registers it. Without this, a later test's Forever
      // create 400s under --randomize.
      await plugins().activate('blizzard');
    }
  });
});

/**
 * ROK-2147 §4 / AC3–4 — a LedgerLink char export's `data.addons` lands on
 * `character_installed_addons` (never in the char snapshot): stored /
 * unchanged / stale, an older export never overwrites, an export without
 * the block leaves the row untouched, `[]` stores empty, a dry run writes
 * nothing. Harness copied from `addon-import-char.mailworthy.integration.spec.ts`.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { AddonCharExport, AddonInstalled } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  buildCharPayload,
  buildImportString,
} from './testing/addon-fixture.builder';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const t = schema.characterInstalledAddons;

let testApp: TestApp;
let gameId: number;
let token: string;
let charId: string;

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

async function createChar(owner: string, name: string): Promise<string> {
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${owner}`)
    .send({ gameId, name, class: 'Paladin', region: 'us', ruleset: 'normal' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const addon = (name: string, loaded = true): AddonInstalled => ({
  name,
  loaded,
});

/** A char export carrying `addons` (omitted when undefined). */
function charWith(
  addons: AddonInstalled[] | undefined,
  exportedAt = FIXTURE_EXPORTED_AT,
): AddonCharExport {
  const base = buildCharPayload({ exportedAt });
  return addons ? { ...base, data: { ...base.data, addons } } : base;
}

async function importChar(payload: AddonCharExport, dryRun = false) {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: buildImportString(payload), dryRun });
  expect(res.status).toBe(200);
  return (res.body as { summary: { addons?: unknown } }).summary.addons;
}

async function storedRows() {
  return testApp.db.select().from(t).where(eq(t.characterId, charId));
}

async function storedNames(): Promise<string[] | undefined> {
  const [row] = await storedRows();
  return row?.addons.map((a) => a.name);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  token = await memberToken('iaexporter');
  charId = await createChar(token, 'Ana Forever');
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2147 — installed-addon list apply', () => {
  it('stores the de-duplicated list with captured_at = exportedAt, never in the snapshot', async () => {
    const outcome = await importChar(
      charWith([
        addon('WeakAuras'),
        addon('Details'),
        addon('weakauras', false),
      ]),
    );
    expect(outcome).toEqual({ status: 'stored', count: 2 });
    const [row] = await storedRows();
    expect(row?.addons.map((a) => a.name)).toEqual(['WeakAuras', 'Details']);
    expect(row?.capturedAt.toISOString()).toBe(
      new Date(FIXTURE_EXPORTED_AT * 1000).toISOString(),
    );
    const [snap] = await testApp.db
      .select()
      .from(schema.characterAddonSnapshots)
      .where(eq(schema.characterAddonSnapshots.characterId, charId));
    expect(snap).toBeDefined();
    expect(Object.keys(snap?.data ?? {})).not.toContain('addons');
  });

  it('a re-import of the same export is unchanged', async () => {
    const payload = charWith([addon('Details')]);
    await importChar(payload);
    expect(await importChar(payload)).toEqual({
      status: 'unchanged',
      count: 1,
    });
  });

  it('an older export never overwrites a newer stored list (stale)', async () => {
    await importChar(charWith([addon('Details')], FIXTURE_EXPORTED_AT));
    const older = charWith([addon('Bagnon')], FIXTURE_EXPORTED_AT - 600);
    expect(await importChar(older)).toEqual({ status: 'stale', count: 1 });
    expect(await storedNames()).toEqual(['Details']);
  });

  it('a newer export replaces the list; [] stores an empty list', async () => {
    await importChar(charWith([addon('Details')], FIXTURE_EXPORTED_AT - 1200));
    const newer = charWith([], FIXTURE_EXPORTED_AT);
    expect(await importChar(newer)).toEqual({ status: 'stored', count: 0 });
    expect(await storedNames()).toEqual([]);
  });

  it('an export WITHOUT the block leaves the stored list untouched', async () => {
    await importChar(charWith([addon('Details')], FIXTURE_EXPORTED_AT - 1200));
    const outcome = await importChar(charWith(undefined, FIXTURE_EXPORTED_AT));
    expect(outcome).toBeUndefined();
    expect(await storedNames()).toEqual(['Details']);
  });

  it('a dry run previews the outcome and writes nothing', async () => {
    const outcome = await importChar(charWith([addon('Details')]), true);
    expect(outcome).toEqual({ status: 'stored', count: 1 });
    expect(await storedRows()).toEqual([]);
  });
});

/**
 * ROK-2100 §6 — a LedgerLink companion upload whose export has `ruleset:
 * null` resolves it on CREATE: admin realm map → Blizzard profile → realm
 * name → `RULESET_REQUIRED` as before. Blizzard is stubbed at the service
 * seam (`fetchForeverRulesetRaw`) and its configured-gate via
 * `getBlizzardConfig`; everything else is the real module on a real DB.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  WOW_LEDGERLINK_CONTRACT_ID,
  WowLedgerlinkMessageSchema,
  type WowLedgerlinkMessage,
  type AddonWho,
  type WowForeverRuleset,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
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
import { BlizzardService } from '../blizzard.service';
import type { ForeverRulesetFetchOutcome } from '../blizzard-forever-ruleset.fetch';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { ForeverRulesetLookupService } from '../forever-ruleset-lookup.service';
import { WOW_LEDGERLINK_EXPORT_PATH } from './wow-ledgerlink.errors';

pinExportClock();

const MESSAGES = `/companion/v1/messages/${WOW_LEDGERLINK_CONTRACT_ID}`;
const FOREVER_SLUG = 'world-of-warcraft-forever';
const RP_PVP_REALM = 'CAMWOW US2 Realm 9 RP PvP';
const UNTAGGED_REALM = 'CAMWOW US2 Realm 9';
const CAPTURED = '2026-09-22T00:00:00Z';
const ENVELOPE = join(
  __dirname,
  '../../../../../packages/contract/companion/wow-ledgerlink/v1/fixtures/char-normal.json',
);

let testApp: TestApp;
let fetchRaw: jest.SpyInstance;

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

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  await ensureGame();
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled('blizzard');
  await plugins.activate('blizzard');
  testApp.app.get(ForeverRulesetLookupService).clearCache();
  jest
    .spyOn(testApp.app.get(SettingsService), 'getBlizzardConfig')
    .mockResolvedValue({ clientId: 'stub-id', clientSecret: 'stub-secret' });
  fetchRaw = jest.spyOn(
    testApp.app.get(BlizzardService),
    'fetchForeverRulesetRaw',
  );
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Stub the Blizzard profile's outcome for every lookup in the test. */
const blizzard = (outcome: ForeverRulesetFetchOutcome): void => {
  fetchRaw.mockResolvedValue(outcome);
};

/** A linked device's `rlcd_` token for a fresh member. */
async function deviceToken(name: string): Promise<string> {
  const user = await makeUser(testApp, name);
  return (await linkDevice(testApp, user.token)).token;
}

/** A companion message whose export's `who` is overridden. */
function upload(who: Partial<AddonWho>, exportedAt = FIXTURE_EXPORTED_AT) {
  const payload = buildCharPayload({ who: buildWho(who), exportedAt });
  const raw: unknown = JSON.parse(readFileSync(ENVELOPE, 'utf8'));
  const message: WowLedgerlinkMessage = {
    ...WowLedgerlinkMessageSchema.parse(raw),
    capturedAt: CAPTURED,
    payload: { exportString: buildImportString(payload) },
  };
  return message;
}

const nullRulesetAt = (realmName: string): Partial<AddonWho> => ({
  ruleset: null,
  raw: { getUnitName: 'Ana Forever', realmName },
});

const post = (token: string, body: unknown) =>
  testApp.request
    .post(MESSAGES)
    .set(bearer(token))
    .send(body as object);

const NOTICE_MESSAGE =
  "Your companion uploaded Ana Forever on CAMWOW US2 Realm 9 but Raid Ledger couldn't tell which ruleset that realm plays (Normal, PvP, RP or RP-PvP). Import it once from Characters → Import from LedgerLink and choose the ruleset — after that, the companion keeps it up to date.";

/** Every notification row (ROK-2100 B.2 — the RULESET_REQUIRED notice). */
async function notices() {
  return testApp.db
    .select({
      type: schema.notifications.type,
      title: schema.notifications.title,
      message: schema.notifications.message,
      payload: schema.notifications.payload,
    })
    .from(schema.notifications);
}

async function rulesets(): Promise<(string | null)[]> {
  const rows = await testApp.db
    .select({ ruleset: schema.characters.ruleset })
    .from(schema.characters);
  return rows.map((r) => r.ruleset);
}

describe('ROK-2100 — null-ruleset companion upload resolves on create', () => {
  it('Blizzard reports PvP → created as pvp (beats the realm name)', async () => {
    const token = await deviceToken('rs-blizzard');
    blizzard({ kind: 'found', ruleset: { type: 'PVP', name: 'PvP' } });
    const res = await post(token, upload(nullRulesetAt(RP_PVP_REALM)));
    expect(res.status).toBe(202);
    expect(await rulesets()).toEqual<WowForeverRuleset[]>(['pvp']);
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });

  it('Blizzard 404 → the realm name infers rppvp', async () => {
    const token = await deviceToken('rs-name');
    blizzard({ kind: 'absent' });
    const res = await post(token, upload(nullRulesetAt(RP_PVP_REALM)));
    expect(res.status).toBe(202);
    expect(await rulesets()).toEqual(['rppvp']);
  });

  it('Blizzard 404 + an untagged realm → 400 RULESET_REQUIRED, nothing created', async () => {
    const token = await deviceToken('rs-none');
    blizzard({ kind: 'absent' });
    const res = await post(token, upload(nullRulesetAt(UNTAGGED_REALM)));
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'RULESET_REQUIRED' },
    ]);
    expect(await rulesets()).toEqual([]);
  });

  it('an existing character is never re-ruleset by Blizzard (F8)', async () => {
    const token = await deviceToken('rs-existing');
    blizzard({ kind: 'found', ruleset: { type: 'PVP' } });
    const first = await post(token, upload({ ruleset: 'normal' }));
    expect(first.status).toBe(202);
    const later = upload(
      nullRulesetAt(RP_PVP_REALM),
      FIXTURE_EXPORTED_AT + 600,
    );
    expect((await post(token, later)).status).toBe(202);
    expect(await rulesets()).toEqual(['normal']);
  });

  it("Forever Armory switch 'false' → Blizzard never called; the name still infers", async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'false');
    try {
      const token = await deviceToken('rs-switch');
      const res = await post(token, upload(nullRulesetAt(RP_PVP_REALM)));
      expect(res.status).toBe(202);
      expect(fetchRaw).not.toHaveBeenCalled();
      expect(await rulesets()).toEqual(['rppvp']);
    } finally {
      await settings.delete(WOW_FOREVER_ARMORY_IMPORT_KEY);
    }
  });
});

describe('ROK-2100 B.2 — the companion RULESET_REQUIRED notice', () => {
  it('RULESET_REQUIRED tells the member once in-app; a repeat within 7 days adds none (B.2)', async () => {
    const token = await deviceToken('rs-notice');
    blizzard({ kind: 'absent' });
    const first = await post(token, upload(nullRulesetAt(UNTAGGED_REALM)));
    expect(first.status).toBe(400);
    expect(await notices()).toEqual([
      {
        type: 'system',
        title: 'Pick a ruleset for Ana Forever',
        message: NOTICE_MESSAGE,
        payload: {
          kind: 'ledgerlink_ruleset_required',
          guid: buildWho().guid,
          characterName: 'Ana Forever',
          realmName: UNTAGGED_REALM,
          link: '/profile/gaming/characters',
        },
      },
    ]);
    const again = upload(
      nullRulesetAt(UNTAGGED_REALM),
      FIXTURE_EXPORTED_AT + 600,
    );
    const second = await post(token, again);
    expect(second.status).toBe(400);
    expect(second.body.issues).toEqual([
      { path: WOW_LEDGERLINK_EXPORT_PATH, code: 'RULESET_REQUIRED' },
    ]);
    expect(await notices()).toHaveLength(1);
  });

  it('a different character on the same account gets its own notice (B.2)', async () => {
    const token = await deviceToken('rs-notice-two');
    blizzard({ kind: 'absent' });
    expect(
      (await post(token, upload(nullRulesetAt(UNTAGGED_REALM)))).status,
    ).toBe(400);
    const other = upload({
      ...nullRulesetAt(UNTAGGED_REALM),
      guid: 'Player-4395-0000CAFE',
    });
    expect((await post(token, other)).status).toBe(400);
    const guids = (await notices()).map((n) => JSON.stringify(n.payload));
    expect(guids).toHaveLength(2);
    expect(guids.some((g) => g.includes('Player-4395-0000CAFE'))).toBe(true);
  });
});

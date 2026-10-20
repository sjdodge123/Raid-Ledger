/**
 * ROK-1739 — the admin realm → ruleset map wired into BOTH import routes
 * against a real database (spec §7.2 I6–I14). Precedence: the export's own
 * `who.ruleset` → the map → unchanged. Per-character route: an inferred
 * value is only ever the opt-in `RULESET_CHANGED`, never auto-written.
 * Create route: the user's pick → the map (never Hardcore) → required.
 * `rulesetInference` rides on preview AND apply results; never persisted.
 */
import * as bcrypt from 'bcrypt';
import { count, eq } from 'drizzle-orm';
import {
  AddonImportResultSchema,
  type AddonWho,
  type WowForeverRealmRulesetEntryDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_REALM_RULESETS_KEY } from '../forever.settings';
import {
  buildCharPayload,
  buildImportString,
  buildWho,
} from './testing/addon-fixture.builder';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const MAP: WowForeverRealmRulesetEntryDto[] = [
  { region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' },
  { region: 'us', realmName: 'Last Stand', ruleset: 'hardcore' },
];
const INFERRED_PVP = {
  ruleset: 'pvp',
  realmName: 'Bloodmoon',
  source: 'realm-map',
};

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
  const login = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return login.body.access_token as string;
}

/** A hand-made Forever character stored on `normal`. */
async function createChar(token: string): Promise<string> {
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
  return res.body.id as string;
}

/** A us char export from `realmName` whose own ruleset is `ruleset`. */
function exportFrom(
  realmName: string,
  ruleset: AddonWho['ruleset'] = null,
): string {
  const { raw } = buildWho();
  const who = buildWho({ ruleset, raw: { ...raw, realmName } });
  return buildImportString(buildCharPayload({ who }));
}

const perChar = (token: string, id: string, s: string, extra = {}) =>
  testApp.request
    .post(`/plugins/wow/characters/${id}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, ...extra });

const createRoute = (token: string, s: string, extra = {}) =>
  testApp.request
    .post('/plugins/wow/characters/addon-import')
    .set('Authorization', `Bearer ${token}`)
    .send({ importString: s, ...extra });

const storedRuleset = async (id: string) =>
  nonEmpty(
    await testApp.db
      .select({ ruleset: schema.characters.ruleset })
      .from(schema.characters)
      .where(eq(schema.characters.id, id)),
    'character',
  )[0].ruleset;

const characterCount = async (): Promise<number> => {
  const [row] = await testApp.db.select({ n: count() }).from(schema.characters);
  return Number(row?.n ?? 0);
};

/** Parses the body against the contract, then keeps `RULESET_CHANGED`. */
const rulesetChanged = (body: unknown) =>
  AddonImportResultSchema.parse(body).warnings.filter(
    (w) => w.code === 'RULESET_CHANGED',
  );

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame();
  // truncateAllTables may wipe `plugins`; re-install, then activate.
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await testApp.app
    .get(SettingsService)
    .set(WOW_FOREVER_REALM_RULESETS_KEY, JSON.stringify({ entries: MAP }));
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('per-character route — realm-map inference (ROK-1739 D4)', () => {
  it('I6 preview: null export ruleset on a mapped realm → RULESET_CHANGED normal→pvp + rulesetInference', async () => {
    const token = await memberToken('realmprev');
    const id = await createChar(token);
    const res = await perChar(token, id, exportFrom('Bloodmoon'));
    expect(res.status).toBe(200);
    expect(rulesetChanged(res.body)).toEqual([
      { code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' },
    ]);
    expect(res.body.rulesetInference).toEqual(INFERRED_PVP);
  });

  it('I7 apply WITHOUT confirm → row stays normal; rulesetInference on the apply result', async () => {
    const token = await memberToken('realmapply');
    const id = await createChar(token);
    const res = await perChar(token, id, exportFrom('Bloodmoon'), {
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(res.body.rulesetInference).toEqual(INFERRED_PVP);
    expect(await storedRuleset(id)).toBe('normal');
  });

  it('I8 apply WITH confirm.updateRuleset → row becomes pvp', async () => {
    const token = await memberToken('realmconfirm');
    const id = await createChar(token);
    const res = await perChar(token, id, exportFrom('Bloodmoon'), {
      dryRun: false,
      confirm: { updateRuleset: true },
    });
    expect(res.status).toBe(200);
    expect(await storedRuleset(id)).toBe('pvp');
  });

  it('I9 unknown realm → no RULESET_CHANGED, no rulesetInference, row unchanged even when confirmed', async () => {
    const token = await memberToken('realmunknown');
    const id = await createChar(token);
    const res = await perChar(token, id, exportFrom('Nowhere Keep'), {
      dryRun: false,
      confirm: { updateRuleset: true },
    });
    expect(res.status).toBe(200);
    expect(rulesetChanged(res.body)).toEqual([]);
    expect(res.body).not.toHaveProperty('rulesetInference');
    expect(await storedRuleset(id)).toBe('normal');
  });

  it("I10 the export's own roleplaying wins over the mapped pvp; no rulesetInference", async () => {
    const token = await memberToken('realmexplicit');
    const id = await createChar(token);
    const res = await perChar(
      token,
      id,
      exportFrom('Bloodmoon', 'roleplaying'),
    );
    expect(res.status).toBe(200);
    expect(rulesetChanged(res.body)).toEqual([
      { code: 'RULESET_CHANGED', from: 'normal', to: 'roleplaying' },
    ]);
    expect(res.body).not.toHaveProperty('rulesetInference');
  });
});

describe('create route — realm-map inference (ROK-1739 D5/D6)', () => {
  it('I11 no pick, mapped pvp: preview keeps target.ruleset null + carries the inference; apply creates on pvp', async () => {
    const token = await memberToken('newmapped');
    const prev = await createRoute(token, exportFrom('Bloodmoon'));
    expect(prev.status).toBe(200);
    expect(prev.body.target).toMatchObject({ action: 'create', ruleset: null });
    expect(prev.body.rulesetInference).toEqual(INFERRED_PVP);
    const res = await createRoute(token, exportFrom('Bloodmoon'), {
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({ action: 'create', ruleset: 'pvp' });
    expect(res.body.rulesetInference).toEqual(INFERRED_PVP);
    expect(await storedRuleset(res.body.target.characterId as string)).toBe(
      'pvp',
    );
  });

  it("I12 the user's pick normal beats the mapped pvp; no RULESET_CHANGED on the result", async () => {
    const token = await memberToken('newpicked');
    const res = await createRoute(token, exportFrom('Bloodmoon'), {
      dryRun: false,
      ruleset: 'normal',
    });
    expect(res.status).toBe(200);
    expect(rulesetChanged(res.body)).toEqual([]);
    expect(await storedRuleset(res.body.target.characterId as string)).toBe(
      'normal',
    );
  });
});

describe('create route — no usable realm-map fallback (ROK-1739 D6)', () => {
  it('I13 no pick, mapped hardcore: preview reports it, apply → 422 RULESET_REQUIRED, nothing created', async () => {
    const token = await memberToken('newhardcore');
    const prev = await createRoute(token, exportFrom('Last Stand'));
    expect(prev.status).toBe(200);
    expect(prev.body.target).toMatchObject({ action: 'create', ruleset: null });
    expect(prev.body.rulesetInference?.ruleset).toBe('hardcore');
    const res = await createRoute(token, exportFrom('Last Stand'), {
      dryRun: false,
    });
    expect(res.body.code).toBe('RULESET_REQUIRED');
    expect(res.status).toBe(422);
    expect(await characterCount()).toBe(0);
  });

  it('I14 no pick, unmapped realm → 422 RULESET_REQUIRED (unchanged), preview has no rulesetInference', async () => {
    const token = await memberToken('newunmapped');
    const prev = await createRoute(token, exportFrom('Nowhere Keep'));
    expect(prev.status).toBe(200);
    expect(prev.body).not.toHaveProperty('rulesetInference');
    const res = await createRoute(token, exportFrom('Nowhere Keep'), {
      dryRun: false,
    });
    expect(res.body.code).toBe('RULESET_REQUIRED');
    expect(res.status).toBe(422);
    expect(await characterCount()).toBe(0);
  });
});

describe('create route — update target (ROK-1739 D4)', () => {
  it('I15 an update target (own hand-made char) gets the opt-in RULESET_CHANGED, row unchanged without confirm', async () => {
    const token = await memberToken('newupdate');
    const id = await createChar(token);
    const res = await createRoute(token, exportFrom('Bloodmoon'), {
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({
      action: 'update',
      characterId: id,
    });
    expect(rulesetChanged(res.body)).toEqual([
      { code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' },
    ]);
    expect(res.body.rulesetInference).toEqual(INFERRED_PVP);
    expect(await storedRuleset(id)).toBe('normal');
  });
});

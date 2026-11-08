/**
 * ROK-2125: LedgerLink may omit `data.quests.completed` (additive v1).
 * Absent = "no opinion": after an Armory sync the Armory completed list
 * survives a log-only import, and a log-only import never drops a completed
 * list stored by an earlier import. An explicitly EMPTY list keeps today's
 * behaviour. Driven through the REAL import endpoint with golden fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { CharacterQuestsResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';
import { pinExportClock } from './addon-import/testing/pin-export-clock';
import {
  buildImportString,
  FIXTURE_EXPORTED_AT,
} from './addon-import/testing/addon-fixture.builder';
import {
  buildForeverQuestsLogOnlyPayload,
  buildForeverQuestsPayload,
  buildForeverQuestsTruncatedPayload,
  buildQuests,
} from './addon-import/testing/addon-fixture.forever';

pinExportClock();

const FIXTURES = join(
  __dirname,
  '../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');
/** `quests.completed: []` + the 3-quest log (same exportedAt as the fixtures). */
const EMPTY_LIST = buildImportString(buildForeverQuestsPayload(0));
/** Armory list: 456 is a known RFC quest; 9001 is unknown. */
const ARMORY = {
  fetchedAt: '2026-09-01T00:00:00.000Z',
  completed: [456, 9001],
};

/** An export `secs` after the fixtures' exportedAt (the clock is pinned +1h). */
const exportAfter = (
  payload: ReturnType<typeof buildForeverQuestsPayload>,
  secs: number,
): string =>
  buildImportString({ ...payload, exportedAt: FIXTURE_EXPORTED_AT + secs });
const LOG_ONLY_LATER = exportAfter(buildForeverQuestsLogOnlyPayload(), 1200);

let testApp: TestApp;

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const rows = await testApp.db
    .insert(schema.games)
    .values({ name: 'World of Warcraft: Forever', slug: WOW_FOREVER_GAME_SLUG })
    .returning();
  return nonEmpty(rows, 'game')[0].id;
}

/** A local member; returns their JWT. */
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

/** Known classic quests: 456 is in the fixture's completed ids, 2459 in its log. */
async function seedKnownQuests(): Promise<void> {
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    {
      questId: 456,
      dungeonInstanceId: 226,
      name: 'RFC Known',
      expansion: 'classic',
      questLevel: 15,
    },
    {
      questId: 2459,
      dungeonInstanceId: 63,
      name: 'VC Known',
      expansion: 'classic',
      questLevel: 20,
    },
  ]);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await seedKnownQuests();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A member with one Forever character; returns the token + character id. */
async function memberWithChar(
  username: string,
): Promise<{ token: string; charId: string }> {
  const token = await memberToken(username);
  const created = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId: await ensureGame(),
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(created.status).toBe(201);
  return { token, charId: created.body.id as string };
}

async function importPaste(
  token: string,
  charId: string,
  importString: string,
): Promise<void> {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString, dryRun: false });
  expect(res.status).toBe(200);
}

async function armorySync(
  charId: string,
  armoryQuests: typeof ARMORY = ARMORY,
): Promise<void> {
  await testApp.db
    .update(schema.characters)
    .set({ armoryQuests })
    .where(eq(schema.characters.id, charId));
}

async function getQuests(charId: string) {
  const res = await testApp.request.get(
    `/plugins/wow/characters/${charId}/quests`,
  );
  expect(res.status).toBe(200);
  return CharacterQuestsResponseSchema.parse(res.body).quests;
}

/** The stored `char` snapshot's quests slice + capture time. */
async function storedSnapshot(charId: string) {
  const [row] = await testApp.db
    .select({
      data: schema.characterAddonSnapshots.data,
      capturedAt: schema.characterAddonSnapshots.capturedAt,
    })
    .from(schema.characterAddonSnapshots)
    .where(eq(schema.characterAddonSnapshots.characterId, charId));
  type Q = { completed?: number[]; completedTruncated?: boolean };
  return {
    quests: (row?.data as { quests?: Q } | undefined)?.quests,
    capturedAt: row?.capturedAt,
  };
}

const rfcIds = (q: Awaited<ReturnType<typeof getQuests>>): number[] =>
  (
    q?.completedKnown.find((g) => g.dungeonInstanceId === 226)?.completed ?? []
  ).map((c) => c.questId);

describe('ROK-2125 — quests.completed absent vs empty', () => {
  it('absent after an Armory sync: the Armory list survives, the log is the import’s', async () => {
    const { token, charId } = await memberWithChar('logonly1');
    await armorySync(charId);
    await importPaste(token, charId, fixture('char-forever-quests-log-only'));
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('blizzard');
    expect(quests?.counts).toMatchObject({ completedTotal: 2, inProgress: 3 });
    expect(rfcIds(quests)).toEqual([456]);
    expect(quests?.inProgress.map((q) => q.questId)).toContain(2459);
  });

  it('absent after an earlier full import: the stored completed list is kept', async () => {
    const { token, charId } = await memberWithChar('logonly2');
    await importPaste(token, charId, fixture('char-forever-quests'));
    await importPaste(token, charId, LOG_ONLY_LATER);
    const stored = await storedSnapshot(charId);
    expect(stored.capturedAt?.getTime()).toBe(
      (FIXTURE_EXPORTED_AT + 1200) * 1000,
    );
    expect(stored.quests?.completed).toHaveLength(10_000);
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('addon');
    expect(quests?.counts).toMatchObject({
      completedTotal: 10_000,
      inProgress: 3,
    });
  });

  it('absent with no list anywhere: the log stays visible, no completed list is invented (review r1)', async () => {
    const { token, charId } = await memberWithChar('logonly3');
    await importPaste(token, charId, fixture('char-forever-quests-log-only'));
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('addon');
    expect(quests?.counts).toMatchObject({
      completedKnown: 0,
      completedTotal: 0,
      inProgress: 3,
    });
    expect(rfcIds(quests)).toEqual([]);
    expect(quests?.inProgress.map((q) => q.questId)).toContain(2459);
  });
});

describe('ROK-2125 review r1 — carried list: Armory ordering and truncation flag', () => {
  it('full export (t1) → Armory sync (t2) → log-only export (t3): the Armory list and date win (review r1)', async () => {
    const { token, charId } = await memberWithChar('logonly4');
    await importPaste(token, charId, fixture('char-forever-quests'));
    const fetchedAt = new Date((FIXTURE_EXPORTED_AT + 600) * 1000);
    await armorySync(charId, { ...ARMORY, fetchedAt: fetchedAt.toISOString() });
    await importPaste(token, charId, LOG_ONLY_LATER);
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('blizzard');
    expect(quests?.syncedAt).toBe(fetchedAt.toISOString());
    expect(quests?.counts).toMatchObject({ completedTotal: 2, inProgress: 3 });
    expect((await storedSnapshot(charId)).quests?.completed).toHaveLength(
      10_000,
    );
  });

  it('the carried list keeps the STORED truncation flag, not the incoming one (review r1)', async () => {
    const { token, charId } = await memberWithChar('logonly5');
    await importPaste(
      token,
      charId,
      buildImportString(buildForeverQuestsTruncatedPayload()),
    );
    await importPaste(token, charId, LOG_ONLY_LATER);
    expect((await storedSnapshot(charId)).quests).toMatchObject({
      completed: [456, 463, 470],
      completedTruncated: true,
    });
  });

  // Own case (not a 2nd member in the one above): a Forever character name has
  // one owner across all players (ROK-1721 idx_characters_ruleset_identity),
  // and the fixture GUID pins to one character — afterEach truncates between.
  it('an incoming truncation flag is ignored when the stored list is carried (review r1)', async () => {
    const stray = buildForeverQuestsLogOnlyPayload();
    const strayQuests = {
      inProgress: buildQuests(0).inProgress,
      completedTruncated: true,
    };
    const strayFlag = {
      ...stray,
      data: { ...stray.data, quests: strayQuests },
    };
    const { token, charId } = await memberWithChar('logonly6');
    await importPaste(token, charId, fixture('char-forever-quests'));
    await importPaste(token, charId, exportAfter(strayFlag, 1200));
    const kept = (await storedSnapshot(charId)).quests;
    expect(kept?.completed).toHaveLength(10_000);
    expect(kept?.completedTruncated).toBeUndefined();
  });
});

describe('ROK-2125 — quests.completed empty (today’s behaviour)', () => {
  it('empty after an Armory sync: today’s behaviour — the Armory list is primary', async () => {
    const { token, charId } = await memberWithChar('emptylist1');
    await armorySync(charId);
    await importPaste(token, charId, EMPTY_LIST);
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('blizzard');
    expect(rfcIds(quests)).toEqual([456]);
  });

  it('empty after a full import: today’s behaviour — the empty list replaces it', async () => {
    const { token, charId } = await memberWithChar('emptylist2');
    await importPaste(token, charId, fixture('char-forever-quests'));
    await importPaste(token, charId, EMPTY_LIST);
    const quests = await getQuests(charId);
    expect(quests?.source).toBe('addon');
    expect(quests?.counts).toMatchObject({ completedTotal: 0, inProgress: 3 });
    expect(rfcIds(quests)).toEqual([]);
  });
});

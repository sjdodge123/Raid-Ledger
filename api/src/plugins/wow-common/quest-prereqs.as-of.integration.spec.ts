/**
 * ROK-2144: a log-only LedgerLink export must not re-date the completed list
 * it carries. `character_addon_snapshots.completed_captured_at` keeps the
 * full export's time (NULL on pre-column rows → reads `captured_at`); the
 * quest log is dated by `captured_at`. Also the Quest Prep response's
 * `inProgressAsOf` (AC10) and `questDataImportedAt` (AC8, Q5: the latest
 * Blizzard catalogue `fetched_at`, null when empty or switched off).
 * Driven through the REAL import endpoint with the golden fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import {
  CharacterQuestsResponseSchema,
  EventQuestPrereqsResponseSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from './forever.settings';
import { QuestProgressReadService } from './quest-progress-read.service';
import { clearKnownQuestMemo } from './event-forever-progress.query';
import { pinExportClock } from './addon-import/testing/pin-export-clock';
import {
  buildImportString,
  FIXTURE_EXPORTED_AT,
} from './addon-import/testing/addon-fixture.builder';
import {
  buildForeverQuestsLogOnlyPayload,
  buildForeverQuestsPayload,
} from './addon-import/testing/addon-fixture.forever';

pinExportClock();

const FIXTURES = join(
  __dirname,
  '../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');

/** Export times: T1 = the fixtures' stamp; the clock is pinned at +1h. */
const at = (secs: number): Date =>
  new Date((FIXTURE_EXPORTED_AT + secs) * 1000);
const T1 = at(0);
const T2 = at(1200);
const T3 = at(2400);

const exportAt = (
  payload: ReturnType<typeof buildForeverQuestsPayload>,
  secs: number,
): string =>
  buildImportString({ ...payload, exportedAt: FIXTURE_EXPORTED_AT + secs });
/** Migration 0292's backfill UPDATE, verbatim — keep the two in step. */
const BACKFILL_0292 = sql`UPDATE "character_addon_snapshots" SET "completed_captured_at" = "captured_at" WHERE "section" = 'char' AND jsonb_typeof("data" -> 'quests' -> 'completed') = 'array'`;

const FULL_T1 = (): string => fixture('char-forever-quests');
const LOG_ONLY_T2 = exportAt(buildForeverQuestsLogOnlyPayload(), 1200);
const LOG_ONLY_T3 = exportAt(buildForeverQuestsLogOnlyPayload(), 2400);

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

/** A local member; returns their id + JWT. */
async function member(
  username: string,
): Promise<{ userId: number; token: string }> {
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

/** Known classic quests: 456 is in the fixture's completed ids (RFC 226), 2459 in its log (WC 63). */
async function seedKnownQuests(): Promise<void> {
  const base = { expansion: 'classic', questLevel: 15 };
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    { ...base, questId: 456, dungeonInstanceId: 226, name: 'RFC Known' },
    { ...base, questId: 2459, dungeonInstanceId: 63, name: 'VC Known' },
  ]);
}

interface Viewer {
  userId: number;
  token: string;
  charId: string;
}

/** A member with one Forever character created through the API. */
async function memberWithChar(username: string): Promise<Viewer> {
  const { userId, token } = await member(username);
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
  return { userId, token, charId: created.body.id as string };
}

async function importPaste(v: Viewer, importString: string): Promise<void> {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${v.charId}/addon-import`)
    .set('Authorization', `Bearer ${v.token}`)
    .send({ importString, dryRun: false });
  expect(res.status).toBe(200);
}

/** The stored `char` snapshot's two capture times. */
async function storedTimes(charId: string) {
  const rows = await testApp.db
    .select({
      capturedAt: schema.characterAddonSnapshots.capturedAt,
      completedCapturedAt: schema.characterAddonSnapshots.completedCapturedAt,
    })
    .from(schema.characterAddonSnapshots)
    .where(eq(schema.characterAddonSnapshots.characterId, charId));
  const row = defined(rows[0], 'char snapshot');
  return {
    capturedAt: row.capturedAt.toISOString(),
    completedCapturedAt: row.completedCapturedAt?.toISOString() ?? null,
  };
}

async function characterQuests(charId: string) {
  const res = await testApp.request.get(
    `/plugins/wow/characters/${charId}/quests`,
  );
  expect(res.status).toBe(200);
  return CharacterQuestsResponseSchema.parse(res.body).quests;
}

/** A Forever event over RFC (226) and WC (63) with `v` signed up. */
async function eventFor(v: Viewer): Promise<number> {
  const now = new Date();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Quest As-Of',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600_000)],
      gameId: await ensureGame(),
      contentInstances: [
        { id: 226, name: 'Ragefire Chasm' },
        { id: 63, name: 'Wailing Caverns' },
      ],
    })
    .returning();
  const id = defined(event, 'event').id;
  testApp.app.get(QuestProgressReadService).invalidateCoverage(id);
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: id, userId: v.userId, characterId: v.charId });
  return id;
}

async function prereqs(v: Viewer, eventId: number) {
  const res = await testApp.request
    .get(`/plugins/wow-classic/events/${eventId}/quest-prereqs/me`)
    .set('Authorization', `Bearer ${v.token}`);
  expect(res.status).toBe(200);
  return EventQuestPrereqsResponseSchema.parse(res.body);
}

interface ProgressRow {
  userId: number;
  questId: number;
  completed: boolean;
  asOf?: string;
}

/** The viewer's addon progress rows' dates, by quest id. */
async function progressAsOf(
  v: Viewer,
  eventId: number,
): Promise<Record<number, string | undefined>> {
  const res = await testApp.request
    .get(`/plugins/wow-classic/events/${eventId}/quest-progress`)
    .set('Authorization', `Bearer ${v.token}`);
  expect(res.status).toBe(200);
  const rows = (res.body as ProgressRow[]).filter((r) => r.userId === v.userId);
  return Object.fromEntries(rows.map((r) => [r.questId, r.asOf]));
}

/** A Blizzard catalogue (ROK-2143 overlay) row fetched at `fetchedAt`. */
async function insertOverlayRow(questId: number, fetchedAt: Date) {
  await testApp.db.insert(schema.wowDungeonQuestBlizzard).values({
    questId,
    areaId: 718,
    dungeonInstanceId: 999,
    title: `Overlay ${questId}`,
    typeId: null,
    rewardXp: 0,
    rewardMoneyCopper: 0,
    rewardItems: [],
    requirementsRaw: null,
    raw: { id: questId },
    fetchedAt,
    runId: `run-${questId}`,
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  clearKnownQuestMemo();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await seedKnownQuests();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2144 — the completed list keeps its own capture time (AC2/AC3/AC5)', () => {
  it('full export T1 → log-only export T2: the stored row keeps T1 for the completed list', async () => {
    const v = await memberWithChar('asof1');
    await importPaste(v, FULL_T1());
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T1.toISOString(),
      completedCapturedAt: T1.toISOString(),
    });
    await importPaste(v, LOG_ONLY_T2);
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T2.toISOString(),
      completedCapturedAt: T1.toISOString(),
    });
  });

  it('AC5: Character Quests, Quest Prep prereqs and completed progress rows show T1; the log shows T2', async () => {
    const v = await memberWithChar('asof2');
    await importPaste(v, FULL_T1());
    await importPaste(v, LOG_ONLY_T2);
    const quests = await characterQuests(v.charId);
    expect(quests?.source).toBe('addon');
    expect(quests?.syncedAt).toBe(T1.toISOString());
    expect(quests?.inProgressSyncedAt).toBe(T2.toISOString());
    const eventId = await eventFor(v);
    const body = await prereqs(v, eventId);
    expect(body?.characterId).toBe(v.charId);
    expect(body?.asOf).toBe(T1.toISOString());
    expect(body?.inProgressAsOf).toBe(T2.toISOString());
    expect(await progressAsOf(v, eventId)).toEqual({
      456: T1.toISOString(),
      2459: T2.toISOString(),
    });
  });

  it('a second log-only export T3 keeps T1 (COALESCE keeps the stored value) and moves the log to T3', async () => {
    const v = await memberWithChar('asof3');
    await importPaste(v, FULL_T1());
    await importPaste(v, LOG_ONLY_T2);
    await importPaste(v, LOG_ONLY_T3);
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T3.toISOString(),
      completedCapturedAt: T1.toISOString(),
    });
    const body = await prereqs(v, await eventFor(v));
    expect(body?.asOf).toBe(T1.toISOString());
    expect(body?.inProgressAsOf).toBe(T3.toISOString());
  });

  it('log-only with no stored row stores NULL; a later full export with completed: [] stamps its own time', async () => {
    const v = await memberWithChar('asof4');
    await importPaste(v, fixture('char-forever-quests-log-only'));
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T1.toISOString(),
      completedCapturedAt: null,
    });
    await importPaste(v, exportAt(buildForeverQuestsPayload(0), 1200));
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T2.toISOString(),
      completedCapturedAt: T2.toISOString(),
    });
  });
});

describe('ROK-2144 — pre-column rows (completed_captured_at NULL) and the backfill', () => {
  /** Simulate a row written before the migration: list stored, column NULL. */
  async function nullOutColumn(charId: string): Promise<void> {
    await testApp.db
      .update(schema.characterAddonSnapshots)
      .set({ completedCapturedAt: null })
      .where(eq(schema.characterAddonSnapshots.characterId, charId));
  }

  it('a NULL completed_captured_at reads as captured_at on every surface', async () => {
    const v = await memberWithChar('asof5');
    await importPaste(v, FULL_T1());
    await nullOutColumn(v.charId);
    expect((await storedTimes(v.charId)).completedCapturedAt).toBeNull();
    const quests = await characterQuests(v.charId);
    expect(quests?.syncedAt).toBe(T1.toISOString());
    const body = await prereqs(v, await eventFor(v));
    expect(body?.asOf).toBe(T1.toISOString());
    expect(body?.inProgressAsOf).toBe(T1.toISOString());
  });

  it('a log-only export over a pre-column row carries the OLD captured_at as the list date', async () => {
    const v = await memberWithChar('asof6');
    await importPaste(v, FULL_T1());
    await nullOutColumn(v.charId);
    await importPaste(v, LOG_ONLY_T2);
    expect(await storedTimes(v.charId)).toEqual({
      capturedAt: T2.toISOString(),
      completedCapturedAt: T1.toISOString(),
    });
    expect((await characterQuests(v.charId))?.syncedAt).toBe(T1.toISOString());
  });

  // The migration itself runs only in the fleet's migration step.
  it('the 0292 backfill stamps a row with a completed list and leaves a log-only row NULL', async () => {
    const full = await memberWithChar('asof7');
    await importPaste(full, FULL_T1());
    await nullOutColumn(full.charId);
    await testApp.db.execute(BACKFILL_0292);
    expect((await storedTimes(full.charId)).completedCapturedAt).toBe(
      T1.toISOString(),
    );
  });

  it('the 0292 backfill leaves a log-only row (no completed list) NULL', async () => {
    const v = await memberWithChar('asof8');
    await importPaste(v, fixture('char-forever-quests-log-only'));
    await testApp.db.execute(BACKFILL_0292);
    expect((await storedTimes(v.charId)).completedCapturedAt).toBeNull();
  });
});

describe('ROK-2144 AC8 — questDataImportedAt (Blizzard catalogue import date)', () => {
  async function viewerOnEvent(username: string) {
    const v = await memberWithChar(username);
    await importPaste(v, FULL_T1());
    return { v, eventId: await eventFor(v) };
  }

  it('is null when the catalogue table is empty', async () => {
    const { v, eventId } = await viewerOnEvent('cat1');
    const body = await prereqs(v, eventId);
    expect(body?.questDataImportedAt).toBeNull();
  });

  it('is the LATEST fetched_at across the catalogue rows', async () => {
    const { v, eventId } = await viewerOnEvent('cat2');
    const older = new Date('2026-11-02T08:00:00.000Z');
    const newer = new Date('2026-11-09T08:00:00.000Z');
    await insertOverlayRow(990701, newer);
    await insertOverlayRow(990702, older);
    const body = await prereqs(v, eventId);
    expect(body?.questDataImportedAt).toBe(newer.toISOString());
  });

  it('is null when the import switch is off, even with catalogue rows', async () => {
    const { v, eventId } = await viewerOnEvent('cat3');
    await insertOverlayRow(990703, new Date('2026-11-09T08:00:00.000Z'));
    const settings = testApp.app.get(SettingsService);
    try {
      await settings.set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false');
      const body = await prereqs(v, eventId);
      expect(body?.questDataImportedAt).toBeNull();
    } finally {
      await settings.delete(WOW_FOREVER_QUEST_IMPORT_KEY);
    }
  });
});

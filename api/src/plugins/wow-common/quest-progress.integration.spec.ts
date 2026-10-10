/**
 * Quest Progress Integration Tests (ROK-569)
 *
 * Verifies quest progress upsert, event progress retrieval, and
 * sharable quest coverage queries against a real PostgreSQL database
 * via HTTP endpoints.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { defined } from '../../common/testing/narrow';
import { QuestProgressReadService } from './quest-progress-read.service';
import { clearKnownQuestMemo } from './event-forever-progress.query';

/** Create a test event owned by the admin user. */
async function createTestEvent(
  testApp: TestApp,
  title: string,
): Promise<typeof schema.events.$inferSelect> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      duration: [now, later],
    })
    .returning();
  return defined(event, 'inserted event');
}

let testApp: TestApp;
let adminToken: string;

async function setupQPTestApp() {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

async function cleanupQP() {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
}

describe('Quest Progress — updateProgress (integration)', () => {
  beforeAll(() => setupQPTestApp());
  afterEach(() => cleanupQP());

  describe('PUT /plugins/wow-classic/events/:eventId/quest-progress', () => {
    it('should insert new quest progress entry', async () => {
      const event = await createTestEvent(testApp, 'Quest Run');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 1001, pickedUp: true, completed: false });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        eventId: event.id,
        questId: 1001,
        pickedUp: true,
        completed: false,
        username: expect.any(String),
      });
    });

    it('should update existing progress entry (upsert)', async () => {
      const event = await createTestEvent(testApp, 'Upsert Event');

      // First insert
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 2001, pickedUp: true, completed: false });

      // Update to completed
      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 2001, completed: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        questId: 2001,
        pickedUp: true,
        completed: true,
      });
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'No Auth Event');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .send({ questId: 3001, pickedUp: true });

      expect(res.status).toBe(401);
    });

    it('should reject invalid body (missing questId)', async () => {
      const event = await createTestEvent(testApp, 'Bad Body Event');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickedUp: true });

      expect(res.status).toBe(400);
    });
  });
});

describe('Quest Progress — getProgress (integration)', () => {
  beforeAll(() => setupQPTestApp());
  afterEach(() => cleanupQP());

  describe('GET /plugins/wow-classic/events/:eventId/quest-progress', () => {
    it('should return all progress entries with usernames', async () => {
      const event = await createTestEvent(testApp, 'Progress Event');

      // Seed progress via API
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 4001, pickedUp: true, completed: false });

      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 4002, pickedUp: true, completed: true });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            questId: 4001,
            pickedUp: true,
            completed: false,
            username: expect.any(String),
          }),
          expect.objectContaining({
            questId: 4002,
            pickedUp: true,
            completed: true,
            username: expect.any(String),
          }),
        ]),
      );
    });

    it('should return empty array for event with no progress', async () => {
      const event = await createTestEvent(testApp, 'Empty Progress Event');

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'Auth Check Event');

      const res = await testApp.request.get(
        `/plugins/wow-classic/events/${event.id}/quest-progress`,
      );

      expect(res.status).toBe(401);
    });
  });
});

describe('Quest Progress — questCoverage (integration)', () => {
  beforeAll(() => setupQPTestApp());
  afterEach(() => cleanupQP());

  describe('GET /plugins/wow-classic/events/:eventId/quest-coverage', () => {
    it('should return coverage grouped by questId', async () => {
      const event = await createTestEvent(testApp, 'Coverage Event');

      // Mark two quests as picked up
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 5001, pickedUp: true });

      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 5002, pickedUp: true });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-coverage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      for (const entry of res.body) {
        expect(entry).toMatchObject({
          questId: expect.any(Number),
          coveredBy: expect.arrayContaining([
            expect.objectContaining({
              userId: expect.any(Number),
              username: expect.any(String),
            }),
          ]),
        });
      }
    });

    it('should exclude quests that are not picked up', async () => {
      const event = await createTestEvent(testApp, 'Not Picked Up Event');

      // Insert progress with pickedUp=false
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 6001, pickedUp: false, completed: false });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-coverage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'Coverage Auth Event');

      const res = await testApp.request.get(
        `/plugins/wow-classic/events/${event.id}/quest-coverage`,
      );

      expect(res.status).toBe(401);
    });
  });
});

// ─── ROK-1748: Forever addon-derived progress ───────────────────────────────

const CAPTURED_AT = new Date('2026-10-01T12:00:00.000Z');
const FOREVER_SLUG = 'world-of-warcraft-forever';

/** Find-or-create a game row by slug. */
async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (found) return found.id;
  const [row] = await testApp.db
    .insert(schema.games)
    .values({ name: slug, slug })
    .returning();
  return defined(row, slug).id;
}

/** Quest 300 (instance 63) chains from 100 (no instance); 200 is in 63; 400 elsewhere. */
async function seedForeverQuests(): Promise<void> {
  const base = { expansion: 'classic', questLevel: 20 };
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    {
      ...base,
      questId: 100,
      dungeonInstanceId: null,
      name: 'Step',
      nextQuestId: 300,
    },
    {
      ...base,
      questId: 300,
      dungeonInstanceId: 63,
      name: 'Final',
      prevQuestId: 100,
    },
    { ...base, questId: 200, dungeonInstanceId: 63, name: 'Sharable' },
    { ...base, questId: 400, dungeonInstanceId: 999, name: 'Elsewhere' },
  ]);
}

/** Event on `slug` covering instance 63. */
async function createGameEvent(slug: string): Promise<number> {
  const now = new Date();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: `Quest ${slug}`,
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600_000)],
      gameId: await ensureGame(slug),
      contentInstances: [{ id: 63, name: 'Wailing Caverns' }],
    })
    .returning();
  const id = defined(event, 'event').id;
  // The app is a singleton: drop any coverage cached for a reused event id.
  testApp.app.get(QuestProgressReadService).invalidateCoverage(id);
  return id;
}

/** A Forever character for `userId`, optionally with a schema-2 snapshot. */
async function seedChar(
  userId: number,
  name: string,
  quests?: { completed: number[]; inProgress: { questId: number }[] },
): Promise<string> {
  const [char] = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId: await ensureGame(FOREVER_SLUG),
      name,
      region: 'us',
    })
    .returning();
  const id = defined(char, name).id;
  if (quests) {
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: id,
      section: 'char',
      schema: 2,
      data: {
        quests,
      } as typeof schema.characterAddonSnapshots.$inferInsert.data,
      capturedAt: CAPTURED_AT,
      payloadSha256: 'c'.repeat(64),
    });
  }
  return id;
}

/** A plain member user. */
async function seedUser(username: string): Promise<number> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ username, discordId: `local:${username}` })
    .returning();
  return defined(user, username).id;
}

async function signUp(
  eventId: number,
  userId: number,
  characterId: string,
  status = 'signed_up',
): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, characterId, status });
}

describe('Quest Progress — Forever addon rows (ROK-1748, integration)', () => {
  let adminId: number;
  let adminChar: string;
  let otherId: number;
  let foreverEvent: number;
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const url = (id: number, path: string) =>
    `/plugins/wow-classic/events/${id}/${path}`;
  const get = (id: number, path: string) =>
    testApp.request.get(url(id, path)).set(auth());
  const put = (id: number, body: Record<string, unknown>) =>
    testApp.request.put(url(id, 'quest-progress')).set(auth()).send(body);

  beforeAll(() => setupQPTestApp());
  afterEach(() => cleanupQP());

  /** Admin: 100+400 done, 200 in log. Other: 300 in log. Declined: 200. */
  beforeEach(async () => {
    clearKnownQuestMemo();
    await seedForeverQuests();
    adminId = testApp.seed.adminUser.id;
    foreverEvent = await createGameEvent(FOREVER_SLUG);
    adminChar = await seedChar(adminId, 'Questa', {
      completed: [100, 400],
      inProgress: [{ questId: 200 }],
    });
    otherId = await seedUser('qp-other');
    const otherChar = await seedChar(otherId, 'Otha', {
      completed: [],
      inProgress: [{ questId: 300 }],
    });
    const declinedId = await seedUser('qp-declined');
    const declinedChar = await seedChar(declinedId, 'Decla', {
      completed: [],
      inProgress: [{ questId: 200 }],
    });
    await signUp(foreverEvent, adminId, adminChar);
    await signUp(foreverEvent, otherId, otherChar);
    await signUp(foreverEvent, declinedId, declinedChar, 'declined');
  });

  it('GET progress returns addon rows (id 0, source, asOf) bounded to the event quests', async () => {
    const res = await get(foreverEvent, 'quest-progress');
    expect(res.status).toBe(200);
    const addon = { id: 0, source: 'addon', asOf: CAPTURED_AT.toISOString() };
    expect(res.body).toHaveLength(3);
    expect(res.body).toEqual(
      expect.arrayContaining([
        {
          ...addon,
          eventId: foreverEvent,
          userId: adminId,
          username: expect.any(String),
          questId: 100,
          pickedUp: false,
          completed: true,
          characterId: adminChar,
        },
        expect.objectContaining({
          ...addon,
          userId: adminId,
          questId: 200,
          pickedUp: true,
          completed: false,
        }),
        expect.objectContaining({
          ...addon,
          userId: otherId,
          questId: 300,
          pickedUp: true,
          username: 'qp-other',
        }),
      ]),
    );
  });

  it('a manual PUT completed:false wins over the addon completed:true (both fields)', async () => {
    expect(
      (await put(foreverEvent, { questId: 100, completed: false })).status,
    ).toBe(200);
    const res = await get(foreverEvent, 'quest-progress');
    const mine = (
      res.body as Array<{ userId: number; questId: number; id: number }>
    ).filter(
      (r: { userId: number; questId: number }) =>
        r.userId === adminId && r.questId === 100,
    );
    expect(mine).toEqual([
      expect.objectContaining({
        source: 'manual',
        completed: false,
        pickedUp: false,
      }),
    ]);
    expect(mine[0]?.id).toBeGreaterThan(0);
  });

  it('PUT on a quest with an addon row fills the unspecified field from it (D5)', async () => {
    const res = await put(foreverEvent, { questId: 100, pickedUp: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      questId: 100,
      pickedUp: true,
      completed: true,
    });
  });

  it('coverage lists addon carriers with source; declined signups are excluded (D8)', async () => {
    const res = await get(foreverEvent, 'quest-coverage');
    expect(res.status).toBe(200);
    const byQuest = new Map(
      (res.body as Array<{ questId: number; coveredBy: unknown[] }>).map(
        (e: { questId: number; coveredBy: unknown[] }) => [
          e.questId,
          e.coveredBy,
        ],
      ),
    );
    expect(byQuest.get(200)).toEqual([
      {
        userId: adminId,
        username: expect.any(String),
        source: 'addon',
        asOf: CAPTURED_AT.toISOString(),
      },
    ]);
    expect(byQuest.get(300)).toEqual([
      expect.objectContaining({ userId: otherId, source: 'addon' }),
    ]);
  });

  it('a departed signup feeds no progress or coverage rows (D8)', async () => {
    const goneId = await seedUser('qp-departed');
    const goneChar = await seedChar(goneId, 'Gona', {
      completed: [100],
      inProgress: [{ questId: 200 }, { questId: 300 }],
    });
    await signUp(foreverEvent, goneId, goneChar, 'departed');
    const progress = await get(foreverEvent, 'quest-progress');
    const rows = progress.body as Array<{ userId: number }>;
    expect(rows.filter((r: { userId: number }) => r.userId === goneId)).toEqual(
      [],
    );
    const coverage = await get(foreverEvent, 'quest-coverage');
    const carriers = (
      coverage.body as Array<{ coveredBy: Array<{ userId: number }> }>
    ).flatMap((e: { coveredBy: Array<{ userId: number }> }) => e.coveredBy);
    expect(carriers.map((c: { userId: number }) => c.userId)).not.toContain(
      goneId,
    );
  });

  it('quest-prereqs/me returns chain states and neededTotal; a manual untick counts as needed', async () => {
    const res = await get(foreverEvent, 'quest-prereqs/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      characterId: adminChar,
      asOf: CAPTURED_AT.toISOString(),
      neededTotal: 0,
    });
    const final = (
      res.body as { quests: Array<{ questId: number; steps: unknown[] }> }
    ).quests.find((q: { questId: number }) => q.questId === 300);
    expect(final?.steps).toEqual([
      { questId: 100, name: 'Step', done: true, source: 'addon' },
    ]);
    await put(foreverEvent, { questId: 100, completed: false });
    const after = await get(foreverEvent, 'quest-prereqs/me');
    expect(after.body.neededTotal).toBe(1);
  });

  it('quest-prereqs/me is a JSON null for a viewer whose character has no snapshot', async () => {
    const bare = await createGameEvent(FOREVER_SLUG);
    await signUp(bare, adminId, await seedChar(adminId, 'Bare'));
    const res = await get(bare, 'quest-prereqs/me');
    expect(res.status).toBe(200);
    expect(res.text).toBe('null');
  });

  it('Classic event with the same snapshot: no addon rows, prereqs null (AC6)', async () => {
    const classic = await createGameEvent('world-of-warcraft-classic');
    await signUp(classic, adminId, adminChar);
    expect((await get(classic, 'quest-progress')).body).toEqual([]);
    expect((await get(classic, 'quest-coverage')).body).toEqual([]);
    expect((await put(classic, { questId: 200, pickedUp: true })).status).toBe(
      200,
    );
    const legacy = await get(classic, 'quest-progress');
    expect(legacy.body).toEqual([
      {
        id: expect.any(Number),
        eventId: classic,
        userId: adminId,
        username: expect.any(String),
        questId: 200,
        pickedUp: true,
        completed: false,
      },
    ]);
    expect((await get(classic, 'quest-coverage')).body).toEqual([
      {
        questId: 200,
        coveredBy: [{ userId: adminId, username: expect.any(String) }],
      },
    ]);
    const prereqs = await get(classic, 'quest-prereqs/me');
    expect(prereqs.status).toBe(200);
    expect(prereqs.text).toBe('null');
  });
});

/**
 * ROK-1911 (H9 of ROK-1905) — `GET /plugins/wow-classic/events/:eventId/
 * quest-readiness` through the real HTTP stack and DB: per-signup states
 * (addon snapshot vs manual tick, D5), `prereqsMet`, `source`; access (guild
 * member / signup / staff vs 403); non-Forever → 404 with Classic quest
 * routes unchanged (D7).
 */
import { EventQuestReadinessSchema } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { clearKnownQuestMemo } from './event-forever-progress.query';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const CLASSIC_SLUG = 'world-of-warcraft-classic';
const CAPTURED_AT = new Date('2026-10-01T12:00:00.000Z');
const HOUR = 3600_000;
type Who = 'ready' | 'ticker' | 'member' | 'outsider';

let testApp: TestApp;
let adminToken: string;
let guildId: number;
let foreverEvent: number;
let classicEvent: number;
const users = {} as Record<Who, { id: number; token: string }>;

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

/** 300 (instance 63) chains from 100; 200 is in 63; 400 is elsewhere. */
async function seedQuests(): Promise<void> {
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

async function insertGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: 'Quest Keepers',
        nameKey: 'quest keepers',
        source: 'addon_import',
        lastSnapshotAt: CAPTURED_AT,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedUser(who: Who): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `qr-${who}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: who,
    role: 'member',
  });
  users[who] = { id: user.id, token };
  return user.id;
}

/** A guild member by roster guid (the WoW hub's membership rule). */
async function makeGuildMember(userId: number, who: Who): Promise<void> {
  const guid = `Player-7-qr-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: `${who}main`,
    addonGuid: guid,
    isMain: true,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: `${who}main`,
    rankIndex: 3,
    rankName: 'Rank 3',
    source: 'addon_import',
    lastSeenAt: CAPTURED_AT,
  });
}

/** A Forever character, optionally with a schema-2 `char` snapshot. */
async function seedForeverChar(
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
      payloadSha256: 'd'.repeat(64),
    });
  }
  return id;
}

async function createEvent(slug: string): Promise<number> {
  const start = new Date(Date.now() + 24 * HOUR);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: `Readiness ${slug}`,
      creatorId: testApp.seed.adminUser.id,
      duration: [start, new Date(start.getTime() + HOUR)],
      gameId: await ensureGame(slug),
      guildId,
      contentInstances: [{ id: 63, name: 'Wailing Caverns' }],
    })
    .returning();
  return defined(event, slug).id;
}

async function signUp(eventId: number, userId: number, characterId: string) {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, characterId, status: 'signed_up' });
}

/** ready: snapshot (100 done, 200 in log). ticker: no snapshot, manual 300 done. */
async function seedRoster(): Promise<void> {
  const ready = await seedUser('ready');
  const ticker = await seedUser('ticker');
  await makeGuildMember(await seedUser('member'), 'member');
  await seedUser('outsider');
  foreverEvent = await createEvent(FOREVER_SLUG);
  classicEvent = await createEvent(CLASSIC_SLUG);
  const readyChar = await seedForeverChar(ready, 'Readya', {
    completed: [100],
    inProgress: [{ questId: 200 }],
  });
  await signUp(foreverEvent, ready, readyChar);
  await signUp(classicEvent, ready, readyChar);
  await signUp(foreverEvent, ticker, await seedForeverChar(ticker, 'Ticka'));
  await testApp.db.insert(schema.wowClassicQuestProgress).values({
    eventId: foreverEvent,
    userId: ticker,
    questId: 300,
    pickedUp: false,
    completed: true,
  });
}

const readiness = (eventId: number, token: string) =>
  testApp.request
    .get(`/plugins/wow-classic/events/${eventId}/quest-readiness`)
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  clearKnownQuestMemo();
  await seedQuests();
  guildId = await insertGuild();
  await seedRoster();
});

afterAll(async () => {
  clearKnownQuestMemo();
  testApp.seed = await truncateAllTables(testApp.db);
});

type Body = {
  quests: { questId: number; title: string; instanceId: number }[];
  signups: {
    userId: number;
    characterId: unknown;
    name: string;
    perQuest: {
      questId: number;
      state: string;
      prereqsMet: unknown;
      source: unknown;
    }[];
  }[];
};
let body: Body;
const cell = (who: Who, questId: number) =>
  body.signups
    .find((s) => s.userId === users[who].id)
    ?.perQuest.find((p) => p.questId === questId);

describe('GET quest-readiness — payload (ROK-1911)', () => {
  beforeAll(async () => {
    const res = await readiness(foreverEvent, users.ready.token);
    expect(res.status).toBe(200);
    body = res.body as Body;
  });

  it('parses against the contract and lists the event quests only', () => {
    expect(EventQuestReadinessSchema.safeParse(body).success).toBe(true);
    expect(body.quests).toHaveLength(2);
    expect(body.quests).toEqual(
      expect.arrayContaining([
        { questId: 300, title: 'Final', instanceId: 63 },
        { questId: 200, title: 'Sharable', instanceId: 63 },
      ]),
    );
  });

  it('lists every active signup by character name', () => {
    expect(body.signups.map((s) => s.name).sort()).toEqual(['Readya', 'Ticka']);
  });

  it('addon snapshot: in-log = have (addon), chain met, untouched = missing', () => {
    expect(cell('ready', 200)).toEqual({
      questId: 200,
      state: 'have',
      prereqsMet: true,
      source: 'addon',
    });
    expect(cell('ready', 300)).toEqual({
      questId: 300,
      state: 'missing',
      prereqsMet: true,
      source: null,
    });
  });

  it('manual tick without a snapshot: done (manual); the rest unknown; prereqs unknown', () => {
    expect(cell('ticker', 300)).toEqual({
      questId: 300,
      state: 'done',
      prereqsMet: null,
      source: 'manual',
    });
    expect(cell('ticker', 200)).toEqual({
      questId: 200,
      state: 'unknown',
      prereqsMet: true,
      source: null,
    });
  });
});

describe('GET quest-readiness — access + D7 (ROK-1911)', () => {
  it('is 200 for a guild member who is not signed up, and for staff', async () => {
    expect((await readiness(foreverEvent, users.member.token)).status).toBe(
      200,
    );
    expect((await readiness(foreverEvent, adminToken)).status).toBe(200);
  });

  it('is 403 for a non-member who is not signed up', async () => {
    expect((await readiness(foreverEvent, users.outsider.token)).status).toBe(
      403,
    );
  });

  it('is 404 for a missing event', async () => {
    expect((await readiness(987654, adminToken)).status).toBe(404);
  });

  it('is 404 for a Classic event; Classic quest-progress stays manual-only', async () => {
    expect((await readiness(classicEvent, users.ready.token)).status).toBe(404);
    const progress = await testApp.request
      .get(`/plugins/wow-classic/events/${classicEvent}/quest-progress`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(progress.status).toBe(200);
    expect(progress.body).toEqual([]);
  });
});

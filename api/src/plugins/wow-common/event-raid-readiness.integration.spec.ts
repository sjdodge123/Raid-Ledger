/**
 * ROK-1926 (W11 of ROK-1905) — `GET /plugins/wow-classic/events/:eventId/
 * raid-readiness` through the real HTTP stack and DB: per-signup level /
 * saved / item-level checks on a Forever raid night (tentative + bench
 * listed, a signup without a character is unknown, never failed), the
 * guild-roster level for a rostered character (D6 `m<memberId>` ref), an
 * event with no content (requirements null → `na`), and the shared access
 * rule (member / signup / staff vs 403; 404 missing; 404 Classic).
 */
import {
  EventRaidReadinessSchema,
  type AddonCharSnapshotData,
  type EventRaidReadiness,
} from '@raid-ledger/contract';
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
const DAY_S = 86_400;
const MOLTEN_CORE = {
  id: 90_000_071,
  name: 'Molten Core',
  shortName: 'MC',
  expansion: 'classic',
  minimumLevel: 60,
  maximumLevel: 60,
  maxPlayers: 40,
  category: 'raid',
};
type Who =
  | 'ready'
  | 'under'
  | 'saved'
  | 'nochar'
  | 'tentative'
  | 'benched'
  | 'rostered'
  | 'member'
  | 'outsider';
type SignupStatus = NonNullable<
  (typeof schema.eventSignups.$inferInsert)['status']
>;
type Row = EventRaidReadiness['signups'][number];

let testApp: TestApp;
let adminToken: string;
let foreverGameId: number;
let guildId: number;
let raidEvent: number;
let raidStart: Date;
let emptyEvent: number;
let classicEvent: number;
const userMap = new Map<Who, { id: number; token: string }>();
const users = (who: Who) => defined(userMap.get(who), `seeded user ${who}`);

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

async function insertGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverGameId,
        region: 'us',
        name: 'Ready Keepers',
        nameKey: 'ready keepers',
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
      .values({ discordId: `rr-${who}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: who,
    role: 'member',
  });
  userMap.set(who, { id: user.id, token });
  return user.id;
}

interface CharSeed {
  level?: number;
  itemLevel?: number;
  guid?: string;
  lockouts?: AddonCharSnapshotData['lockouts'];
}

/** A Forever character, optionally with a LedgerLink `char` snapshot. */
async function seedChar(userId: number, name: string, c: CharSeed = {}) {
  const [char] = await testApp.db
    .insert(schema.characters)
    .values({
      userId,
      gameId: foreverGameId,
      name,
      region: 'us',
      level: c.level ?? null,
      itemLevel: c.itemLevel ?? null,
      addonGuid: c.guid ?? null,
    })
    .returning();
  const id = defined(char, name).id;
  if (c.lockouts) {
    const data: AddonCharSnapshotData = {
      gear: [],
      talents: { nodes: [] },
      lockouts: c.lockouts,
    };
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId: id,
      section: 'char',
      schema: 2,
      data,
      capturedAt: CAPTURED_AT,
      payloadSha256: 'e'.repeat(64),
    });
  }
  return id;
}

/** A latest-snapshot roster row whose guid links `who`'s character. */
async function rosterRow(who: Who, level: number): Promise<string> {
  const guid = `Player-7-rr-${who}`;
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: `${who}main`,
    level,
    rankIndex: 3,
    rankName: 'Rank 3',
    source: 'addon_import',
    lastSeenAt: CAPTURED_AT,
  });
  return guid;
}

async function createEvent(slug: string, content: unknown[]) {
  const start = new Date(Date.now() + 24 * HOUR);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: `Raid readiness ${slug} ${content.length}`,
      creatorId: testApp.seed.adminUser.id,
      duration: [start, new Date(start.getTime() + 3 * HOUR)],
      gameId: await ensureGame(slug),
      guildId,
      contentInstances: content,
    })
    .returning();
  return { id: defined(event, slug).id, start };
}

async function signUp(
  eventId: number,
  userId: number,
  characterId: string | null,
  status: SignupStatus = 'signed_up',
): Promise<number> {
  const [row] = await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, characterId, status })
    .returning();
  return defined(row, `signup ${userId}`).id;
}

/** A save on Molten Core that resets `days` after the raid starts. */
const mcSave = (days: number) => ({
  name: 'Molten Core',
  instanceId: 409,
  difficultyId: 9,
  resetAt: Math.floor(raidStart.getTime() / 1000) + days * DAY_S,
  killed: 3,
  total: 10,
});

async function seedSignups(): Promise<void> {
  const char = async (who: Who, c: CharSeed = {}) =>
    seedChar(await seedUser(who), `${who}char`, c);
  const fit = { level: 60, itemLevel: 60 };
  const ids = {
    ready: await char('ready', { ...fit, lockouts: [mcSave(-1)] }),
    under: await char('under', { level: 52, itemLevel: 60 }),
    saved: await char('saved', { level: 60, lockouts: [mcSave(3)] }),
    tentative: await char('tentative', fit),
    benched: await char('benched', fit),
    rostered: await char('rostered', { guid: await rosterRow('rostered', 58) }),
  };
  for (const who of ['ready', 'under', 'saved', 'rostered'] as const) {
    await signUp(raidEvent, users(who).id, ids[who]);
  }
  await signUp(raidEvent, await seedUser('nochar'), null);
  await signUp(raidEvent, users('tentative').id, ids.tentative, 'tentative');
  const benchSignup = await signUp(raidEvent, users('benched').id, ids.benched);
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId: raidEvent, signupId: benchSignup, role: 'bench' });
  await signUp(emptyEvent, users('under').id, ids.under);
  await signUp(classicEvent, users('ready').id, ids.ready);
}

/** member: a roster member (guid link) who is not signed up. */
async function seedReaders(): Promise<void> {
  const member = await seedUser('member');
  await seedChar(member, 'membermain', {
    guid: await rosterRow('member', 60),
  });
  await seedUser('outsider');
}

const readiness = (eventId: number, token: string) =>
  testApp.request
    .get(`/plugins/wow-classic/events/${eventId}/raid-readiness`)
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  clearKnownQuestMemo();
  foreverGameId = await ensureGame(FOREVER_SLUG);
  guildId = await insertGuild();
  const raid = await createEvent(FOREVER_SLUG, [MOLTEN_CORE]);
  raidEvent = raid.id;
  raidStart = raid.start;
  emptyEvent = (await createEvent(FOREVER_SLUG, [])).id;
  classicEvent = (await createEvent(CLASSIC_SLUG, [MOLTEN_CORE])).id;
  await seedSignups();
  await seedReaders();
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll (integration-setup.ts:85), and the next spec truncates in beforeAll.
afterAll(() => {
  clearKnownQuestMemo();
});

let body: EventRaidReadiness;
const row = (who: Who): Row =>
  defined(
    body.signups.find((s) => s.userId === users(who).id),
    `row for ${who}`,
  );

async function loadRaidBody(): Promise<void> {
  const res = await readiness(raidEvent, users('ready').token);
  expect(res.status).toBe(200);
  body = EventRaidReadinessSchema.parse(res.body);
}

describe('GET raid-readiness — payload (ROK-1926)', () => {
  beforeAll(loadRaidBody);

  it('states the raid requirements from the event content', () => {
    expect(body.event.id).toBe(raidEvent);
    expect(body.requirements).toEqual({
      minLevel: 60,
      ilvlFloor: 55,
      raidNames: ['Molten Core'],
      questCount: 0,
    });
  });

  it('lists every active signup, tentative and bench included', () => {
    expect(body.signups.map((s) => s.userId).sort((a, b) => a - b)).toEqual(
      (
        [
          'ready',
          'under',
          'saved',
          'rostered',
          'nochar',
          'tentative',
          'benched',
        ] as const
      )
        .map((w) => users(w).id)
        .sort((a, b) => a - b),
    );
  });

  it('a fit, unsaved level-60 character is ready (an expired save passes)', () => {
    const r = row('ready');
    expect(r.level).toMatchObject({ state: 'pass', value: 60 });
    expect(r.saved.state).toBe('pass');
    expect(r.ilvl).toMatchObject({ state: 'pass', value: 60 });
    expect(r.quests.state).toBe('na');
    expect(r.overall).toBe('pass');
  });

  it('a level-52 character on a level-60 raid fails the level check', () => {
    expect(row('under').level).toMatchObject({ state: 'fail', value: 52 });
    expect(row('under').overall).toBe('fail');
  });

  it('a save still locked at raid start fails with the instance and reset', () => {
    const saved = row('saved').saved;
    expect(saved.state).toBe('fail');
    expect(saved.instanceName).toBe('Molten Core');
    expect(saved.resetAt).not.toBeNull();
    expect(row('saved').ilvl.state).toBe('unknown');
  });
});

describe('GET raid-readiness — unknowns + roster facts (ROK-1926)', () => {
  beforeAll(loadRaidBody);

  it('no LedgerLink export → saved unknown, not pass or fail', () => {
    expect(row('under').saved.state).toBe('unknown');
  });

  it('a signup with no character is unknown on every check, never fail', () => {
    const r = row('nochar');
    expect(r.characterId).toBeNull();
    expect(r.name).toBe('nochar');
    expect(r.level.state).toBe('unknown');
    expect(r.saved.state).toBe('unknown');
    expect(r.ilvl.state).toBe('unknown');
    expect(r.overall).toBe('unknown');
  });

  it('a rostered character reads its level from the guild roster (D6)', () => {
    expect(row('rostered').level).toMatchObject({
      state: 'fail',
      value: 58,
      source: 'roster',
    });
  });
});

describe('GET raid-readiness — event with no content (ROK-1926)', () => {
  it('has null requirements and `na` level / saved / ilvl checks', async () => {
    const res = await readiness(emptyEvent, users('under').token);
    expect(res.status).toBe(200);
    const empty = EventRaidReadinessSchema.parse(res.body);
    expect(empty.requirements).toEqual({
      minLevel: null,
      ilvlFloor: null,
      raidNames: [],
      questCount: 0,
    });
    const r = defined(empty.signups[0], 'empty-event row');
    expect(r.level.state).toBe('na');
    expect(r.saved.state).toBe('na');
    expect(r.ilvl.state).toBe('na');
    expect(r.overall).toBe('pass');
  });
});

describe('GET raid-readiness — access (ROK-1926)', () => {
  it('is 200 for a guild member who is not signed up, and for staff', async () => {
    expect((await readiness(raidEvent, users('member').token)).status).toBe(
      200,
    );
    expect((await readiness(raidEvent, adminToken)).status).toBe(200);
  });

  it('is 403 for a visitor (non-member, not signed up)', async () => {
    const res = await readiness(raidEvent, users('outsider').token);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('signups');
  });

  it('is 403, not 404, for a visitor on a Classic event', async () => {
    expect(
      (await readiness(classicEvent, users('outsider').token)).status,
    ).toBe(403);
  });

  it('is 404 for a missing event and for a Classic event', async () => {
    expect((await readiness(987654, adminToken)).status).toBe(404);
    expect((await readiness(classicEvent, users('ready').token)).status).toBe(
      404,
    );
  });
});

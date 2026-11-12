/**
 * ROK-2185 item 3 — `GET /guilds/:id/events/past` through the real HTTP stack
 * and DB: keyset paging over the hub's FULL ended history (Q4 = A), the
 * hub-event filter (cancelled, future, rescheduling-poll and other-hub events
 * excluded), microsecond end times, the overview-read gate (an open community
 * hub's visitor may page; a members-only hub's may not) and cursor validation.
 */
import { eq, sql } from 'drizzle-orm';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
type Who = 'member' | 'outsider';

interface PastCard {
  id: number;
  title: string;
  startTime: string;
  signedUp: number;
  attended: number | null;
}
interface PastPage {
  events: PastCard[];
  nextCursor: string | null;
}

let testApp: TestApp;
let guildId: number;
let otherGuildId: number;
let microGuildId: number;
let communityGuildId: number;
const microIds: number[] = [];
const users = {} as Record<Who, { id: number; charId: string; token: string }>;
const endedIds: number[] = [];
const excluded: Record<string, number> = {};

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: new Date(),
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedUser(who: Who, member: boolean): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `past-${who}`,
        username: `past-${who}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  const guid = `Player-7-past-${who}`;
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: `past${who}`,
        addonGuid: guid,
        role: 'dps',
        isMain: true,
      })
      .returning(),
    'character',
  );
  if (member) {
    await testApp.db.insert(schema.guildMembers).values({
      guildId,
      guid,
      characterName: `past${who}`,
      rankIndex: 1,
      rankName: 'Rank 1',
      source: 'addon_import',
      lastSeenAt: new Date(),
    });
  }
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: `past-${who}`,
    role: 'member',
  });
  users[who] = { id: user.id, charId: char.id, token };
}

interface Ev {
  title: string;
  startMs: number;
  guild?: number;
  cancelled?: boolean;
  pollId?: number;
}

async function ev(e: Ev): Promise<number> {
  const start = new Date(e.startMs);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: e.title,
        gameId: testApp.seed.game.id,
        creatorId: users.member.id,
        duration: [start, new Date(start.getTime() + 3 * HOUR)],
        guildId: e.guild ?? guildId,
        cancelledAt: e.cancelled ? new Date() : null,
        reschedulingPollId: e.pollId ?? null,
      })
      .returning(),
    e.title,
  );
  return row.id;
}

/**
 * 25 ended hub events: 24 daily ones, two of which (#19, #20) end at the
 * same instant so the page boundary falls inside a tie (id breaks it), plus
 * one 100 days old — far past the 8-week `raids.recent` window.
 */
async function seedEvents(): Promise<void> {
  const base = Date.now() - 4 * HOUR;
  for (let i = 0; i < 24; i++) {
    const offset = i === 20 ? 19 : i;
    endedIds.push(
      await ev({ title: `past-${i}`, startMs: base - offset * DAY }),
    );
  }
  endedIds.push(await ev({ title: 'past-ancient', startMs: base - 100 * DAY }));
  excluded.cancelled = await ev({
    title: 'cancelled',
    startMs: base - 2 * HOUR,
    cancelled: true,
  });
  excluded.future = await ev({ title: 'future', startMs: Date.now() + DAY });
  excluded.poll = await ev({
    title: 'rescheduling-poll',
    startMs: base - 1 * HOUR,
    pollId: 987654,
  });
  excluded.other = await ev({
    title: 'other-hub',
    startMs: base - 3 * HOUR,
    guild: otherGuildId,
  });
}

/** An open (active, unhidden) community hub with one ended event. */
async function seedCommunityHub(): Promise<void> {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name: 'Past Open Commons',
        nameKey: 'past open commons',
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    'community hub',
  );
  communityGuildId = h.id;
  await ev({ title: 'commons-past', startMs: Date.now() - DAY, guild: h.id });
}

/**
 * 21 events in one hub whose ends fall in the SAME millisecond, a distinct
 * microsecond apart — the cursor (a JS Date) can only carry the millisecond.
 */
async function seedMicroHub(): Promise<void> {
  microGuildId = await insertGuild('Micro Keepers');
  await testApp.db.insert(schema.guildMembers).values({
    guildId: microGuildId,
    guid: 'Player-7-past-member',
    characterName: 'pastmember',
    rankIndex: 1,
    rankName: 'Rank 1',
    source: 'addon_import',
    lastSeenAt: new Date(),
  });
  const endMs = Math.floor((Date.now() - DAY) / 1000) * 1000 + 123;
  for (let k = 1; k <= 21; k++) {
    const id = await ev({
      title: `micro-${k}`,
      startMs: endMs - 3 * HOUR,
      guild: microGuildId,
    });
    microIds.push(id);
    await testApp.db
      .update(schema.events)
      .set({
        duration: sql`tsrange(lower(duration), upper(duration) + make_interval(secs => ${k / 1e6}), '[)')`,
      })
      .where(eq(schema.events.id, id));
  }
}

function getPast(token: string, cursor?: string, hub = guildId) {
  const req = testApp.request
    .get(`/guilds/${hub}/events/past`)
    .set('Authorization', `Bearer ${token}`);
  return cursor === undefined ? req : req.query({ cursor });
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Past Keepers');
  otherGuildId = await insertGuild('Other Past Keepers');
  await seedUser('member', true);
  await seedUser('outsider', false);
  await seedEvents();
  await seedCommunityHub();
  await seedMicroHub();
});

describe('GET /guilds/:id/events/past — paging', () => {
  it('pages 25 ended events as 20 + cursor, then 5 + null, newest first', async () => {
    const first = await getPast(users.member.token);
    expect(first.status).toBe(200);
    const p1 = first.body as PastPage;
    expect(p1.events).toHaveLength(20);
    expect(p1.nextCursor).toEqual(expect.any(String));

    const second = await getPast(users.member.token, p1.nextCursor ?? '');
    expect(second.status).toBe(200);
    const p2 = second.body as PastPage;
    expect(p2.events).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();

    const all = [...p1.events, ...p2.events];
    expect(all.map((e) => e.id).sort((a, b) => a - b)).toEqual(
      [...endedIds].sort((a, b) => a - b),
    );
    const starts = all.map((e) => Date.parse(e.startTime));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    expect(all.at(-1)?.title).toBe('past-ancient');
  });

  it('excludes cancelled, future, rescheduling-poll and other-hub events', async () => {
    const p1 = (await getPast(users.member.token)).body as PastPage;
    const ids = p1.events.map((e) => e.id);
    expect(ids).not.toContain(excluded.cancelled);
    expect(ids).not.toContain(excluded.poll);
    expect(ids).not.toContain(excluded.future);
    expect(ids).not.toContain(excluded.other);
  });
});

describe('GET /guilds/:id/events/past — microsecond end times', () => {
  it('pages 21 ends inside one millisecond as 20 + 1 with no skip or duplicate', async () => {
    const p1 = (await getPast(users.member.token, undefined, microGuildId))
      .body as PastPage;
    expect(p1.events).toHaveLength(20);
    const p2 = (
      await getPast(users.member.token, p1.nextCursor ?? '', microGuildId)
    ).body as PastPage;
    expect(p2.nextCursor).toBeNull();
    const ids = [...p1.events, ...p2.events].map((e) => e.id);
    expect(ids).toHaveLength(21);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      [...microIds].sort((a, b) => a - b),
    );
  });
});

describe('GET /guilds/:id/events/past — access and validation', () => {
  it('is 200 for a signed-in visitor on an open community hub (same rule as the overview)', async () => {
    const res = await getPast(
      users.outsider.token,
      undefined,
      communityGuildId,
    );
    expect(res.status).toBe(200);
    const titles = (res.body as PastPage).events.map((e) => e.title);
    expect(titles).toEqual(['commons-past']);
  });

  it('is 403 for a visitor on a members-only hub', async () => {
    const res = await getPast(users.outsider.token);
    expect(res.status).toBe(403);
  });

  it('is 400 for a malformed cursor', async () => {
    const res = await getPast(users.member.token, 'not-a-cursor!!');
    expect(res.status).toBe(400);
  });
});

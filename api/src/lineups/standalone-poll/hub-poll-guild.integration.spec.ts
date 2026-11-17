/**
 * ROK-2212 (operator ruling 2026-11-17, F1) — a scheduling poll may be tagged
 * to a `wow_guild` hub of the poll's game, for that hub's members and staff
 * only. Guild membership is a live linked roster row (GUID link in the latest
 * snapshot), NOT a `hub_community_members` row. Fleet-only (real Postgres).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const BLIZZARD = 'blizzard';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');

interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let adminToken: string;
let foreverId: number;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;
const registry = () => testApp.app.get(PluginRegistryService);

async function ensureForever(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'forever game',
  );
  return made.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await registry().ensureInstalled(BLIZZARD);
});

beforeEach(async () => {
  if (!registry().isActive(BLIZZARD)) await registry().activate(BLIZZARD);
  foreverId = await ensureForever();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function mkUser(): Promise<Who> {
  const username = next('hpg');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username, role: 'member' })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

/** A `wow_guild` hub (default: the Forever game, visible). */
async function mkGuild(opts: { gameId?: number; hidden?: boolean } = {}) {
  const name = next('Hpg Guild');
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: opts.gameId ?? foreverId,
        kind: 'wow_guild',
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAPSHOT,
        ...(opts.hidden ? { hiddenAt: new Date() } : {}),
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g;
}

/** Makes `who` a guild member: a roster row GUID-linked to their character. */
async function linkMember(guildId: number, who: Who): Promise<void> {
  const characterName = next('Hpgchar');
  const guid = `G-${characterName}`;
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    characterName,
    guid,
    source: 'addon_import',
    lastSeenAt: SNAPSHOT,
    class: 'Warrior',
    level: 60,
  });
  await testApp.db.insert(schema.characters).values({
    userId: who.id,
    gameId: foreverId,
    name: characterName,
    region: 'us',
    ruleset: 'normal',
    addonGuid: guid,
  });
}

function createPoll(token: string, hubId: number) {
  return testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId: foreverId, hubId });
}

async function lineupGuildId(matchId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ guildId: schema.communityLineups.guildId })
      .from(schema.communityLineupMatches)
      .innerJoin(
        schema.communityLineups,
        eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
      )
      .where(eq(schema.communityLineupMatches.id, matchId)),
    'lineup',
  );
  return row.guildId;
}

const matchIdOf = (body: unknown): number => (body as { id: number }).id;

describe('hub polls — wow_guild hub tag (ROK-2212)', () => {
  it('stores the guild hub when a guild member tags the poll', async () => {
    const member = await mkUser();
    const guild = await mkGuild();
    await linkMember(guild.id, member);
    const res = await createPoll(member.token, guild.id);
    expect({ status: res.status, body: res.body as unknown }).toMatchObject({
      status: 201,
    });
    expect(await lineupGuildId(matchIdOf(res.body))).toBe(guild.id);
  });

  it("lists the tagged poll under the guild hub's open polls", async () => {
    const member = await mkUser();
    const guild = await mkGuild();
    await linkMember(guild.id, member);
    const created = await createPoll(member.token, guild.id);
    expect(created.status).toBe(201);
    const list = await testApp.request
      .get(`/hubs/${String(guild.id)}/polls`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(list.status).toBe(200);
    const ids = (list.body as { matchId: number }[]).map((p) => p.matchId);
    expect(ids).toContain(matchIdOf(created.body));
  });

  it('staff may tag a guild hub they are not on the roster of', async () => {
    const guild = await mkGuild();
    const res = await createPoll(adminToken, guild.id);
    expect(res.status).toBe(201);
    expect(await lineupGuildId(matchIdOf(res.body))).toBe(guild.id);
  });

  it('403s a non-member of the guild hub', async () => {
    const guild = await mkGuild();
    await linkMember(guild.id, await mkUser());
    const outsider = await mkUser();
    const res = await createPoll(outsider.token, guild.id);
    expect(res.status).toBe(403);
  });

  it('400s a guild hub of another game', async () => {
    const member = await mkUser();
    const guild = await mkGuild({ gameId: testApp.seed.game.id });
    await linkMember(guild.id, member);
    const res = await createPoll(member.token, guild.id);
    expect(res.status).toBe(400);
    expect((res.body as { message?: unknown }).message).toBe(
      "The poll's game must match the hub's game",
    );
  });

  it('400s a hidden guild hub, even for a member', async () => {
    const member = await mkUser();
    const guild = await mkGuild({ hidden: true });
    await linkMember(guild.id, member);
    const res = await createPoll(member.token, guild.id);
    expect(res.status).toBe(400);
    expect((res.body as { message?: unknown }).message).toBe(
      'That hub is not open for polls',
    );
  });
});

/** A yes vote on a fresh slot of `matchId` (the poll page's voter chips). */
async function addYesVote(matchId: number, userId: number): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 864e5),
        suggestedBy: 'user',
      })
      .returning(),
    'slot',
  );
  await testApp.db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId, stance: 'yes' });
}

/** Lock the poll in as `token`; returns the new event's stored guild_id. */
async function lockInGuildId(
  token: string,
  matchId: number,
): Promise<number | null> {
  const start = new Date(Date.now() + 3 * 864e5);
  const res = await testApp.request
    .post(`/scheduling-polls/${matchId}/lock-in`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      event: {
        title: 'Guild lock-in',
        gameId: foreverId,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 72e5).toISOString(),
      },
    });
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  const eventId = (res.body as { event: { id: number } }).event.id;
  const [row] = nonEmpty(
    await testApp.db
      .select({ guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event',
  );
  return row.guildId;
}

type PageVoter = { userId: number; isHubMember?: boolean };

describe('hub polls — wow_guild hub membership on lock-in + poll page (ROK-2212)', () => {
  it('a guild member locking in a guild-hub poll gets an event tagged to the guild hub', async () => {
    const member = await mkUser();
    const guild = await mkGuild();
    await linkMember(guild.id, member);
    const poll = await createPoll(member.token, guild.id);
    expect(poll.status).toBe(201);
    expect(await lockInGuildId(member.token, matchIdOf(poll.body))).toBe(
      guild.id,
    );
  });

  it('flags a guild member voter as a hub member, an outsider voter not', async () => {
    const member = await mkUser();
    const outsider = await mkUser();
    const guild = await mkGuild();
    await linkMember(guild.id, member);
    const poll = await createPoll(member.token, guild.id);
    expect(poll.status).toBe(201);
    const matchId = matchIdOf(poll.body);
    const { lineupId } = poll.body as { lineupId: number };
    await addYesVote(matchId, member.id);
    await addYesVote(matchId, outsider.id);
    const page = await testApp.request
      .get(`/lineups/${lineupId}/schedule/${matchId}`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(page.status).toBe(200);
    const body = page.body as {
      hub: { id: number; viewerIsMember: boolean; kind?: string } | null;
      slots: { votes: PageVoter[] }[];
    };
    expect(body.hub).toMatchObject({
      id: guild.id,
      viewerIsMember: true,
      kind: 'wow_guild',
    });
    const voters = body.slots.flatMap((s) => s.votes);
    const flag = (id: number) => voters.find((v) => v.userId === id);
    expect(flag(member.id)?.isHubMember).toBe(true);
    expect(flag(outsider.id)?.isHubMember).toBe(false);
  });
  it('a member whose roster row is unlinked before lock-in gets an untagged event', async () => {
    const member = await mkUser();
    const guild = await mkGuild();
    await linkMember(guild.id, member);
    const poll = await createPoll(member.token, guild.id);
    expect(poll.status).toBe(201);
    const matchId = matchIdOf(poll.body);
    expect(await lineupGuildId(matchId)).toBe(guild.id);
    // The member's character no longer GUID-links to the roster row.
    await testApp.db
      .update(schema.characters)
      .set({ addonGuid: null })
      .where(eq(schema.characters.userId, member.id));
    expect(await lockInGuildId(member.token, matchId)).toBeNull();
  });
});

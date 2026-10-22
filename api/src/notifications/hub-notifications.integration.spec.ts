/**
 * ROK-1832 — per-group (hub) notifications end-to-end against a real DB:
 *
 *   AC1  POST /guilds/:id/posts → `hub_leader_post` per member, per NEW post
 *        (ROK-1868; edits/deletes never notify, legacy PATCH gmPost → 400)
 *   AC2  a group-tagged event → one notice per (member, event); late tag
 *   AC3  rules / links edits never notify
 *   AC4  `hub_event_tagged` channel preferences are honoured
 *
 * The leader post and the late tag are fire-and-forget EventEmitter
 * listeners; each test spies on the listener's service method (calling
 * through) and awaits the promises it returned — no sleeps, no polling. The
 * announce is driven through `notifyGameAffinity`, as the two production
 * callers do. Discord dispatch is stubbed on the real app singleton.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EmbedPosterService } from '../discord-bot/services/embed-poster.service';
import { EmbedSchedulerService } from '../discord-bot/services/embed-scheduler.service';
import { DiscordNotificationService } from './discord-notification.service';
import { GameAffinityNotificationService } from './game-affinity-notification.service';
import { HubNotificationService } from './hub-notification.service';
import { NotificationService } from './notification.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SNAP = new Date('2026-10-12T20:00:00.000Z');
const DEDUP_PREFIXES = ['hub-post:*', 'game-alert:*', 'event-notice:*'];

interface RedisLike {
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
}

let testApp: TestApp;
let adminToken: string;
let adminId: number;
let hub: HubNotificationService;
let seq = 0;
let leaderSpy: jest.SpiedFunction<HubNotificationService['notifyLeaderPost']>;
let lateTagSpy: jest.SpiedFunction<HubNotificationService['notifyLateTag']>;
let dispatch: jest.SpiedFunction<DiscordNotificationService['dispatch']>;

/** A WoW hub for the seeded game, with a live roster snapshot. */
async function insertHub(): Promise<{ id: number; name: string }> {
  seq += 1;
  const name = `Hub Bell ${seq}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return { id: g.id, name };
}

async function mkUser(label: string): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:hubbell-${label}-${seq}@hubbell.test`,
        username: `hubbell-${label}-${seq}`,
      })
      .returning(),
    'user',
  );
  return u.id;
}

/** A character whose GUID is on the hub's live roster ⇒ a member. */
async function link(guildId: number, userId: number): Promise<void> {
  const guid = `Player-1-hubbell-${guildId}-${userId}`;
  const name = `Hb${guildId}x${userId}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name,
    addonGuid: guid,
    role: 'dps',
    // Not a main: a user (the admin) is linked to several hubs across tests,
    // and idx_one_main_per_game allows one main per (user, game).
    isMain: false,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: name,
    rankIndex: 3,
    rankName: 'Rank 3',
    source: 'addon_import',
    lastSeenAt: SNAP,
  });
}

async function member(guildId: number, label: string): Promise<number> {
  const id = await mkUser(label);
  await link(guildId, id);
  return id;
}

async function muteHub(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubNotificationMutes)
    .values({ guildId, userId });
}

async function heartGame(userId: number): Promise<void> {
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId: testApp.seed.game.id });
}

/** Notification rows for a user, optionally filtered by type. */
async function rowsFor(userId: number, type?: string) {
  const rows = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  return type === undefined ? rows : rows.filter((r) => r.type === type);
}

/** Awaits every promise the spied fire-and-forget method returned. */
async function settle(spy: {
  mock: { results: ReadonlyArray<{ value: unknown }> };
}): Promise<void> {
  await Promise.allSettled(spy.mock.results.map((r) => r.value));
}

const patchProfile = (guildId: number, body: Record<string, unknown>) =>
  testApp.request
    .patch(`/guilds/${guildId}/profile`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

/** ROK-1868: the leader post is a hub post now (relay off unless asked). */
const createPost = (guildId: number, body: string) =>
  testApp.request
    .post(`/guilds/${guildId}/posts`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ body, relayToDiscord: false });

const patchEvent = (eventId: number, body: Record<string, unknown>) =>
  testApp.request
    .patch(`/events/${eventId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

/** A future event created by the admin, optionally tagged to a group. */
async function insertEvent(guildId: number | null): Promise<{
  id: number;
  title: string;
  start: Date;
  end: Date;
}> {
  seq += 1;
  const start = new Date(Date.now() + DAY);
  const end = new Date(start.getTime() + 2 * HOUR);
  const title = `Hub Bell Raid ${seq}`;
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId: adminId,
        gameId: testApp.seed.game.id,
        guildId,
        duration: [start, end],
      })
      .returning(),
    'event',
  );
  return { id: e.id, title, start, end };
}

/** The announce, exactly as the embed listener / lifecycle processor call it. */
async function announce(event: {
  id: number;
  title: string;
  start: Date;
  end: Date;
}): Promise<void> {
  await testApp.app.get(GameAffinityNotificationService).notifyGameAffinity({
    eventId: event.id,
    eventTitle: event.title,
    gameName: testApp.seed.game.name,
    gameId: testApp.seed.game.id,
    startTime: event.start.toISOString(),
    endTime: event.end.toISOString(),
    creatorId: adminId,
  });
}

async function setTaggedPrefs(
  userId: number,
  prefs: { inApp: boolean; discord: boolean },
): Promise<void> {
  await testApp.app
    .get(NotificationService)
    .updatePreferences(userId, { channelPrefs: { hub_event_tagged: prefs } });
}

const dispatchedTo = (userId: number): number =>
  dispatch.mock.calls.filter(([input]) => input.userId === userId).length;

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  adminId = testApp.seed.adminUser.id;
  hub = testApp.app.get(HubNotificationService);
});

beforeEach(async () => {
  const redis = testApp.app.get<RedisLike>(REDIS_CLIENT);
  for (const pattern of DEDUP_PREFIXES) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
  leaderSpy = jest.spyOn(hub, 'notifyLeaderPost');
  lateTagSpy = jest.spyOn(hub, 'notifyLateTag');
  dispatch = jest
    .spyOn(testApp.app.get(DiscordNotificationService), 'dispatch')
    .mockResolvedValue(false);
});

afterEach(() => jest.restoreAllMocks());

/** A hub with: the admin author (a member), a member, a muted member, a deactivated member. */
async function leaderScenario() {
  const g = await insertHub();
  await link(g.id, adminId);
  const fan = await member(g.id, 'fan');
  const muted = await member(g.id, 'muted');
  await muteHub(g.id, muted);
  const gone = await member(g.id, 'gone');
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, gone));
  return { g, fan, muted, gone };
}

describe('AC1 — leader post', () => {
  it('notifies each active, unmuted member — not the author, a muted or a deactivated member', async () => {
    const { g, fan, muted, gone } = await leaderScenario();
    const res = await createPost(g.id, '**Raid** tonight at 8\nBring flasks');
    expect(res.status).toBe(201);
    const postId = (res.body as { post: { id: number } }).post.id;
    expect(leaderSpy).toHaveBeenCalledTimes(1);
    await settle(leaderSpy);
    const rows = await rowsFor(fan, 'hub_leader_post');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: `New post in ${g.name}`,
      message: 'Raid tonight at 8',
      payload: {
        guildId: g.id,
        guildName: g.name,
        url: `/guilds/${g.id}?post=${postId}#posts`,
        postId,
      },
    });
    expect(await rowsFor(muted)).toHaveLength(0);
    expect(await rowsFor(gone)).toHaveLength(0);
    expect(await rowsFor(adminId, 'hub_leader_post')).toHaveLength(0);
  });

  it('a second post inside the cooldown adds nothing', async () => {
    const { g, fan } = await leaderScenario();
    expect((await createPost(g.id, 'First post')).status).toBe(201);
    expect((await createPost(g.id, 'Second post')).status).toBe(201);
    expect(leaderSpy).toHaveBeenCalledTimes(2);
    await settle(leaderSpy);
    expect(await rowsFor(fan, 'hub_leader_post')).toHaveLength(1);
  });
});

describe('AC1 — only a NEW post notifies (ROK-1868)', () => {
  it('editing or deleting a post notifies nobody', async () => {
    const { g, fan } = await leaderScenario();
    const created = await createPost(g.id, 'First post');
    await settle(leaderSpy);
    const path = `/guilds/${g.id}/posts/${(created.body as { post: { id: number } }).post.id}`;
    const auth = `Bearer ${adminToken}`;
    const edit = await testApp.request
      .patch(path)
      .set('Authorization', auth)
      .send({ body: 'First post, typo fixed' });
    expect(edit.status).toBe(200);
    const del = await testApp.request.delete(path).set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(leaderSpy).toHaveBeenCalledTimes(1);
    expect(await rowsFor(fan, 'hub_leader_post')).toHaveLength(1);
  });

  it('the legacy PATCH profile gmPost is refused (400) and notifies nobody', async () => {
    const { g, fan } = await leaderScenario();
    for (const gmPost of ['Raid tonight', null]) {
      const res = await patchProfile(g.id, { gmPost });
      expect(res.status).toBe(400);
    }
    expect(leaderSpy).not.toHaveBeenCalled();
    expect(await rowsFor(fan)).toHaveLength(0);
  });
});

describe('AC2 — event tagged to the group', () => {
  it('a member who also hearts the game gets exactly one row: the group copy', async () => {
    const g = await insertHub();
    const fan = await member(g.id, 'fan');
    await heartGame(fan);
    const event = await insertEvent(g.id);
    await announce(event);
    const rows = await rowsFor(fan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'hub_event_tagged',
      title: event.title,
      message: `Tagged to ${g.name}`,
      payload: expect.objectContaining({
        eventId: event.id,
        gameId: testApp.seed.game.id,
        guildId: g.id,
        guildName: g.name,
        url: `/events/${event.id}`,
      }),
    });
  });

  it('a group-muted member who hearts the game gets the subscribed_game copy only', async () => {
    const g = await insertHub();
    const muted = await member(g.id, 'muted');
    await muteHub(g.id, muted);
    await heartGame(muted);
    await announce(await insertEvent(g.id));
    expect(await rowsFor(muted, 'subscribed_game')).toHaveLength(1);
    expect(await rowsFor(muted)).toHaveLength(1);
  });

  it('re-saving the event with the same group notifies nothing new', async () => {
    const g = await insertHub();
    const fan = await member(g.id, 'fan');
    const event = await insertEvent(g.id);
    await announce(event);
    const res = await patchEvent(event.id, { guildId: g.id });
    expect(res.status).toBe(200);
    expect(lateTagSpy).not.toHaveBeenCalled();
    expect(await rowsFor(fan)).toHaveLength(1);
  });

  it('a late tag on an announced, not-started event sends one group notice; an already-told member gets none', async () => {
    const g = await insertHub();
    const fan = await member(g.id, 'fan');
    const told = await member(g.id, 'told');
    await heartGame(told);
    const event = await insertEvent(null);
    await announce(event);
    expect(await rowsFor(told, 'subscribed_game')).toHaveLength(1);
    const res = await patchEvent(event.id, { guildId: g.id });
    expect(res.status).toBe(200);
    expect(lateTagSpy).toHaveBeenCalledTimes(1);
    await settle(lateTagSpy);
    const rows = await rowsFor(fan, 'hub_event_tagged');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe(`Tagged to ${g.name}`);
    expect(await rowsFor(told)).toHaveLength(1);
  });
});

describe('AC3 — edits that never notify', () => {
  it.each([
    ['rules', { rules: [{ title: 'Loot', body: 'Need before greed.' }] }],
    [
      'links',
      {
        links: [
          {
            title: 'Guides',
            links: [{ label: 'Wiki', url: 'https://example.com/wiki' }],
          },
        ],
      },
    ],
  ])('a %s-only PATCH sends nothing', async (_label, body) => {
    const g = await insertHub();
    const fan = await member(g.id, 'fan');
    const res = await patchProfile(g.id, body);
    expect(res.status).toBe(200);
    expect(leaderSpy).not.toHaveBeenCalled();
    expect(await rowsFor(fan)).toHaveLength(0);
  });
});

describe('AC4 — hub_event_tagged channel preferences', () => {
  it('both channels off: no row and no Discord dispatch (a defaults member still gets both)', async () => {
    const g = await insertHub();
    const off = await member(g.id, 'off');
    const fan = await member(g.id, 'fan');
    await setTaggedPrefs(off, { inApp: false, discord: false });
    await announce(await insertEvent(g.id));
    expect(await rowsFor(off)).toHaveLength(0);
    expect(dispatchedTo(off)).toBe(0);
    expect(await rowsFor(fan, 'hub_event_tagged')).toHaveLength(1);
    expect(dispatchedTo(fan)).toBe(1);
  });

  it('in-app off + Discord on: no row and, per OQ-1 (create gates on in-app first), no DM', async () => {
    const g = await insertHub();
    const dmOnly = await member(g.id, 'dm-only');
    await setTaggedPrefs(dmOnly, { inApp: false, discord: true });
    await announce(await insertEvent(g.id));
    expect(await rowsFor(dmOnly)).toHaveLength(0);
    expect(dispatchedTo(dmOnly)).toBe(0);
  });
});

describe('Codex r5 — a hidden hub tells staff only (HubVisibleGuard parity)', () => {
  /** A hidden hub with the admin author, an ordinary member and an operator member. */
  async function hiddenScenario() {
    const g = await insertHub();
    await link(g.id, adminId);
    const fan = await member(g.id, 'fan');
    const op = await member(g.id, 'op');
    await testApp.db
      .update(schema.users)
      .set({ role: 'operator' })
      .where(eq(schema.users.id, op));
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, g.id));
    return { g, fan, op };
  }

  it('leader post: the ordinary member gets nothing, the operator still gets it', async () => {
    const { g, fan, op } = await hiddenScenario();
    const res = await createPost(g.id, 'Hidden raid plans');
    expect(res.status).toBe(201);
    await settle(leaderSpy);
    expect(await rowsFor(fan)).toHaveLength(0);
    expect(await rowsFor(op, 'hub_leader_post')).toHaveLength(1);
  });

  it('tagged event: the ordinary member gets nothing, the operator still gets it', async () => {
    const { g, fan, op } = await hiddenScenario();
    await announce(await insertEvent(g.id));
    expect(await rowsFor(fan)).toHaveLength(0);
    expect(await rowsFor(op, 'hub_event_tagged')).toHaveLength(1);
  });

  it('late tag: the ordinary member gets nothing, the operator still gets it', async () => {
    const { g, fan, op } = await hiddenScenario();
    const event = await insertEvent(null);
    await announce(event);
    await testApp.db
      .update(schema.events)
      .set({ guildId: g.id })
      .where(eq(schema.events.id, event.id));
    await hub.notifyLateTag(event.id);
    expect(await rowsFor(fan)).toHaveLength(0);
    expect(await rowsFor(op, 'hub_event_tagged')).toHaveLength(1);
  });
});

describe('Codex r5 — deferred announce on an install with no connected bot', () => {
  it('a due group-tagged event is announced in-app when the post fails; a later successful post adds nothing', async () => {
    const g = await insertHub();
    const fan = await member(g.id, 'fan');
    const event = await insertEvent(g.id);
    const post = jest
      .spyOn(testApp.app.get(EmbedPosterService), 'postEmbed')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const scheduler = testApp.app.get(EmbedSchedulerService);
    const tick = () =>
      scheduler['tryPostDeferredEmbed'](
        {
          id: event.id,
          duration: [event.start, event.end],
          title: event.title,
          description: null,
          gameId: testApp.seed.game.id,
          recurrenceRule: null,
          recurrenceGroupId: null,
          notificationChannelOverride: null,
          maxAttendees: null,
          slotConfig: null,
          guildId: g.id,
          creatorId: adminId,
        },
        'UTC',
        new Date(),
      );
    expect(await tick()).toBe(false);
    expect(await rowsFor(fan, 'hub_event_tagged')).toHaveLength(1);
    expect(await tick()).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(await rowsFor(fan)).toHaveLength(1);
  });
});

/**
 * ROK-2272 S5a — `GET/PUT /admin/discord/event-planning-forum` against a
 * real database: the admin guard, the candidate list for 0 / 1 / 2 bound
 * forums, a pick taking effect at once (resolver invalidated), a
 * non-candidate refused, null clearing. Discord is the in-memory fake behind
 * `HubForumDiscordGateway`. FLEET-ONLY (Postgres + the Redis sidecar).
 */
import type { EventPlanningForumSettingsDto } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  bootPostsApp,
  newHub,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';

const ROUTE = '/admin/discord/event-planning-forum';
const KEY = schema.SETTING_KEYS.DISCORD_BOT_EVENT_PLANNING_FORUM;

let ctx: PostsCtx;
let adminToken: string;
let fake: FakeDiscord;

beforeAll(async () => {
  ctx = await bootPostsApp('epfadmin');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:epfadmin-admin@forum.test',
        username: 'epfadmin-admin',
        role: 'admin',
      })
      .returning(),
    'admin',
  );
  adminToken = await signTestAccessToken(ctx.testApp, {
    sub: u.id,
    username: u.username,
    role: 'admin',
  });
});

beforeEach(async () => {
  fake = stubForumGateway(ctx.testApp);
  const f = schema.hubForumDiscordForums;
  await ctx.testApp.db
    .delete(f)
    .where(eq(f.discordGuildId, FAKE_DISCORD_GUILD));
  await settings().delete(KEY);
  resolver().invalidate();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const settings = () => ctx.testApp.app.get(SettingsService);
const resolver = () => ctx.testApp.app.get(EventPlanningForumResolver);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A Discord forum `name` that a fresh hub binds; returns its channel id. */
async function boundForum(name: string, managed = false): Promise<string> {
  const channelId = fake.put({ name }).id;
  const hubId = await newHub(ctx);
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId, managed })
      .returning(),
    'forum',
  );
  const at = new Date();
  await ctx.testApp.db
    .insert(schema.hubForumDiscordBindings)
    .values({ guildId: hubId, forumId: row.id, ackAt: at, boundAt: at });
  return channelId;
}

async function getAsAdmin(): Promise<EventPlanningForumSettingsDto> {
  const res = await ctx.testApp.request.get(ROUTE).set(bearer(adminToken));
  expect(res.status).toBe(200);
  return res.body as EventPlanningForumSettingsDto;
}

const putAsAdmin = (body: object) =>
  ctx.testApp.request.put(ROUTE).set(bearer(adminToken)).send(body);

describe('event-planning forum admin — auth', () => {
  it('401 without a token (GET and PUT)', async () => {
    expect((await ctx.testApp.request.get(ROUTE)).status).toBe(401);
    const put = await ctx.testApp.request.put(ROUTE).send({ channelId: null });
    expect(put.status).toBe(401);
  });

  it('403 for a non-admin (GET and PUT)', async () => {
    const who = bearer(ctx.tokens.plain);
    expect((await ctx.testApp.request.get(ROUTE).set(who)).status).toBe(403);
    const put = await ctx.testApp.request
      .put(ROUTE)
      .set(who)
      .send({ channelId: null });
    expect(put.status).toBe(403);
  });
});

describe('event-planning forum admin — GET', () => {
  it('0 bound forums ⇒ no candidates, nothing resolved, no warning', async () => {
    const dto = await getAsAdmin();
    expect(dto).toEqual({
      channelId: null,
      candidates: [],
      resolvedChannelId: null,
    });
    expect(dto).not.toHaveProperty('warning');
  });

  it('1 bound forum ⇒ it is used automatically', async () => {
    const a = await boundForum('raids');
    expect(await getAsAdmin()).toEqual({
      channelId: null,
      candidates: [{ channelId: a, name: 'raids', managed: false }],
      resolvedChannelId: a,
    });
  });

  it('2 bound forums, no pick ⇒ both listed, none resolved, ambiguous', async () => {
    const a = await boundForum('raids');
    const b = await boundForum('pvp', true);
    expect(await getAsAdmin()).toEqual({
      channelId: null,
      candidates: [
        { channelId: a, name: 'raids', managed: false },
        { channelId: b, name: 'pvp', managed: true },
      ],
      resolvedChannelId: null,
      warning: 'ambiguous',
    });
  });

  it('bot offline ⇒ the unknown warning', async () => {
    await boundForum('raids');
    fake.state.online = false;
    const dto = await getAsAdmin();
    expect(dto.warning).toBe('unknown');
    expect(dto.resolvedChannelId).toBeNull();
  });
});

describe('event-planning forum admin — PUT', () => {
  it('a valid pick is stored and resolves immediately', async () => {
    await boundForum('raids');
    const b = await boundForum('pvp');
    expect((await getAsAdmin()).resolvedChannelId).toBeNull(); // primes cache
    const res = await putAsAdmin({ channelId: b });
    expect(res.status).toBe(200);
    const dto = res.body as EventPlanningForumSettingsDto;
    expect(dto.channelId).toBe(b);
    expect(dto.resolvedChannelId).toBe(b);
    expect(await settings().get(KEY)).toBe(b);
    const now = await resolver().resolve(FAKE_DISCORD_GUILD);
    expect(now.forum?.channelId).toBe(b);
  });

  it('a non-candidate channel ⇒ 400 and the setting is unchanged', async () => {
    const a = await boundForum('raids');
    await boundForum('pvp');
    expect((await putAsAdmin({ channelId: a })).status).toBe(200);
    const unbound = fake.put({ name: 'general' }).id;
    for (const channelId of [unbound, snowflake()]) {
      expect((await putAsAdmin({ channelId })).status).toBe(400);
    }
    expect((await putAsAdmin({ channelId: 'nope' })).status).toBe(400);
    expect((await putAsAdmin({})).status).toBe(400);
    expect(await settings().get(KEY)).toBe(a);
    expect((await getAsAdmin()).resolvedChannelId).toBe(a);
  });

  it('null clears the pick', async () => {
    const a = await boundForum('raids');
    await boundForum('pvp');
    expect((await putAsAdmin({ channelId: a })).status).toBe(200);
    const res = await putAsAdmin({ channelId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      channelId: null,
      resolvedChannelId: null,
      warning: 'ambiguous',
    });
    expect(await settings().get(KEY)).toBeNull();
  });
});

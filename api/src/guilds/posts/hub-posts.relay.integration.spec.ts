/**
 * ROK-1868 §2.7 — the hub post Discord relay + notification dedup against a
 * real database (P9–P12, P15, P16, P20, P26). Discord is stubbed on the
 * singleton `DiscordBotClientService` (a connected bot, one bound text
 * channel); the relay's fire-and-forget `unrelay` and the leader-post
 * listener are spied (calling through) and settled — no sleeps, no polling.
 */
import { DiscordAPIError, PermissionFlagsBits } from 'discord.js';
import { markdownToPlainText } from '@raid-ledger/contract';
import { HubNotificationService } from '../../notifications/hub-notification.service';
import { HubPostRelayService } from './hub-post-relay.service';
import {
  bindChannel,
  bootPostsApp,
  call,
  CHANNEL_ID,
  clearPostCooldowns,
  CLIENT_URL,
  createPost,
  DISCORD_GUILD_ID,
  leaderRows,
  newHub,
  postRows,
  profileRow,
  settle,
  stubDiscord,
  type PostsCtx,
} from './hub-posts.test-fixtures';

let ctx: PostsCtx;
let discord: ReturnType<typeof stubDiscord>;
let leaderSpy: jest.SpiedFunction<HubNotificationService['notifyLeaderPost']>;

beforeAll(async () => {
  ctx = await bootPostsApp('hprelay');
});

beforeEach(async () => {
  await clearPostCooldowns(ctx);
  discord = stubDiscord(ctx);
  leaderSpy = jest.spyOn(
    ctx.testApp.app.get(HubNotificationService),
    'notifyLeaderPost',
  );
});

afterEach(() => jest.restoreAllMocks());

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${code}` },
    code,
    403,
    'POST',
    `/channels/${CHANNEL_ID}/messages`,
    {},
  );
}

/** The embed description + the single button's URL of send call `n`. */
function sentEmbed(n = 0): { description: string; buttonUrls: string[] } {
  const args = discord.sendEmbed.mock.calls[n];
  if (!args) throw new Error(`sendEmbed call ${n} missing`);
  const [channelId, embed, row, content] = args;
  expect(channelId).toBe(CHANNEL_ID);
  expect(content).toBeUndefined();
  const components = row?.toJSON().components ?? [];
  const buttonUrls = components.map((c) => ('url' in c ? (c.url ?? '') : ''));
  return { description: embed.toJSON().description ?? '', buttonUrls };
}

const relayPost = (
  g: number,
  body: string,
  who: 'officerA' | 'officerB' = 'officerA',
) => createPost(ctx, g, body, who, true);

/** ~1300 source chars of the D14 subset: bold, links, code, a list. */
const LONG_MARKDOWN = Array.from(
  { length: 12 },
  (_, i) =>
    `**Week ${i}** raid: read [the plan](https://example.com/plan/${i}) and bring \`flask\` plus food.`,
)
  .concat(['- first item', '- second item'])
  .join('\n');

describe('P9 — relay sent', () => {
  it('sends ONE embed, stores the ids, excerpt is safe, default → true', async () => {
    expect(LONG_MARKDOWN.length).toBeGreaterThan(1200);
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const res = await relayPost(g, LONG_MARKDOWN);
    expect(res.status).toBe(201);
    expect(res.body.relayOutcome).toBe('sent');
    expect(discord.sendEmbed).toHaveBeenCalledTimes(1);
    const [row] = await postRows(ctx, g);
    const messageId = row?.relayMessageId ?? '';
    expect(row?.relayChannelId).toBe(CHANNEL_ID);
    expect(messageId).toMatch(/^\d+$/);
    expect(res.body.post.relay).toMatchObject({
      channelId: CHANNEL_ID,
      messageUrl: `https://discord.com/channels/${DISCORD_GUILD_ID}/${CHANNEL_ID}/${messageId}`,
    });
    const { description, buttonUrls } = sentEmbed();
    expect(description.endsWith('…')).toBe(true);
    const visible = markdownToPlainText(description.slice(0, -1));
    expect(visible.length).toBeLessThanOrEqual(300);
    expect((description.match(/\*\*/g) ?? []).length % 2).toBe(0);
    expect((description.match(/`/g) ?? []).length % 2).toBe(0);
    const withoutLinks = description.replace(/\[[^\]]*\]\([^)]*\)/g, '');
    expect(withoutLinks).not.toMatch(/\[|\]\(/);
    expect(buttonUrls).toEqual([
      `${CLIENT_URL}/guilds/${g}?post=${row?.id}#posts`,
    ]);
    expect((await profileRow(ctx, g))?.postRelayDefault).toBe(true);
  });
});

describe('P10–P11 — relay not sent', () => {
  it('P10: no channel bound → unavailable, no send, default unchanged', async () => {
    const g = await newHub(ctx);
    const res = await relayPost(g, 'Raid tonight');
    expect(res.status).toBe(201);
    expect(res.body.relayOutcome).toBe('unavailable');
    expect(discord.sendEmbed).not.toHaveBeenCalled();
    expect((await profileRow(ctx, g))?.postRelayDefault ?? false).toBe(false);
  });

  it('P11: sendEmbed rejects 50013 → 201 failed, post kept, relay columns NULL', async () => {
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    discord.sendEmbed.mockRejectedValueOnce(apiError(50013));
    const res = await relayPost(g, 'Raid tonight');
    expect(res.status).toBe(201);
    expect(res.body.relayOutcome).toBe('failed');
    expect(res.body.post.relay).toBeNull();
    const rows = await postRows(ctx, g);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      body: 'Raid tonight',
      relayChannelId: null,
      relayMessageId: null,
    });
  });
});

describe('P12, P15 — a relayed post is never re-sent', () => {
  it('P12: PATCH → 200 editedBy set; no Discord write, no new notification', async () => {
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const created = await relayPost(g, 'Original plan');
    expect(created.body.relayOutcome).toBe('sent');
    await settle(leaderSpy);
    expect(await leaderRows(ctx, ctx.userIds.plain)).toHaveLength(1);
    const id = (created.body.post as { id: number }).id;
    discord.sendEmbed.mockClear();
    await clearPostCooldowns(ctx);
    const res = await call(
      ctx,
      'patch',
      `/guilds/${g}/posts/${id}`,
      'officerB',
      {
        body: 'Updated plan',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.editedBy).toMatchObject({ userId: ctx.userIds.officerB });
    expect(discord.sendEmbed).not.toHaveBeenCalled();
    expect(discord.editEmbed).not.toHaveBeenCalled();
    expect(leaderSpy).toHaveBeenCalledTimes(1);
    expect(await leaderRows(ctx, ctx.userIds.plain)).toHaveLength(1);
    expect(await leaderRows(ctx, ctx.userIds.officerA)).toHaveLength(0);
  });

  it('P15: DELETE → 204, row gone, deleteMessage once, GET → 404', async () => {
    const unrelay = jest.spyOn(
      ctx.testApp.app.get(HubPostRelayService),
      'unrelay',
    );
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const created = await relayPost(g, 'Short-lived');
    expect(created.body.relayOutcome).toBe('sent');
    const [row] = await postRows(ctx, g);
    const id = (created.body.post as { id: number }).id;
    const path = `/guilds/${g}/posts/${id}`;
    const res = await call(ctx, 'delete', path, 'officerB');
    expect(res.status).toBe(204);
    await settle(unrelay);
    expect(await postRows(ctx, g)).toHaveLength(0);
    expect(discord.deleteMessage).toHaveBeenCalledTimes(1);
    expect(discord.deleteMessage).toHaveBeenCalledWith(
      CHANNEL_ID,
      row?.relayMessageId,
    );
    expect((await call(ctx, 'get', path, 'plain')).status).toBe(404);
    expect(leaderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('P16 — cooldown vs relay', () => {
  it('two posts inside an hour: one notice round, two relays', async () => {
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const first = await relayPost(g, 'First post');
    await settle(leaderSpy); // the first fan-out owns the cooldown before post 2
    const second = await relayPost(g, 'Second post', 'officerB');
    expect([first.status, second.status]).toEqual([201, 201]);
    expect([first.body.relayOutcome, second.body.relayOutcome]).toEqual([
      'sent',
      'sent',
    ]);
    expect(leaderSpy).toHaveBeenCalledTimes(2);
    await settle(leaderSpy);
    expect(await leaderRows(ctx, ctx.userIds.plain)).toHaveLength(1);
    const [notice] = await leaderRows(ctx, ctx.userIds.plain);
    const firstId = (first.body.post as { id: number }).id;
    expect(notice?.payload).toMatchObject({
      url: `/guilds/${g}?post=${firstId}#posts`,
    });
    expect(discord.sendEmbed).toHaveBeenCalledTimes(2);
  });
});

describe('P20 — composer', () => {
  const composer = (g: number, who: 'officerA' | 'plain') =>
    call(ctx, 'get', `/guilds/${g}/posts/composer`, who);

  it('unbound → {relayDefault:false, channel:{state:"unset"}}; bound + perms → ok', async () => {
    const g = await newHub(ctx);
    const unbound = await composer(g, 'officerA');
    expect(unbound.status).toBe(200);
    expect(unbound.body).toEqual({
      relayDefault: false,
      channel: { state: 'unset' },
    });
    await bindChannel(ctx, g);
    const bound = await composer(g, 'officerA');
    expect(bound.status).toBe(200);
    expect(bound.body).toEqual({
      relayDefault: false,
      channel: {
        state: 'ok',
        channelId: CHANNEL_ID,
        channelName: 'announcements',
      },
    });
  });

  it('a bot missing Embed Links reads no-permission', async () => {
    jest.restoreAllMocks();
    discord = stubDiscord(ctx, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const res = await composer(g, 'officerA');
    expect(res.body.channel).toMatchObject({ state: 'no-permission' });
  });

  it('a plain member → 403', async () => {
    const g = await newHub(ctx);
    const res = await composer(g, 'plain');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Guild editor access required');
  });
});

describe('P26 — Discord-only syntax in the excerpt', () => {
  it('absolutises app links and escapes mentions + spoilers', async () => {
    const g = await newHub(ctx);
    await bindChannel(ctx, g);
    const res = await relayPost(
      g,
      'See [plan](/events), ping <@123> and ||spoiler||',
    );
    expect(res.status).toBe(201);
    expect(res.body.relayOutcome).toBe('sent');
    const { description } = sentEmbed();
    expect(description).toContain(`(${CLIENT_URL}/events)`);
    expect(description).toContain('\\<@123>');
    expect(description).toContain('\\|\\|spoiler\\|\\|');
  });
});

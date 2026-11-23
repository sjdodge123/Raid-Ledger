/**
 * ROK-2258 — binding a hub to a Discord forum dresses the forum: a tag for
 * the lone hub (stored on the binding), an Event tag, 👍 as the default
 * reaction, and Require tags only once a second hub shares the forum.
 * Discord is the in-memory fake behind `HubForumDiscordGateway`.
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import {
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';

let ctx: PostsCtx;
let adminToken: string;
let fake: FakeDiscord;

beforeAll(async () => {
  ctx = await bootPostsApp('hfddecor');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfddecor-admin@forum.test',
        username: 'hfddecor-admin',
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

beforeEach(() => {
  fake = stubForumGateway(ctx.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const join = (g: number, channelId: string) =>
  ctx.testApp.request
    .put(`/guilds/${g}/forum-discord`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ mode: 'existing', channelId, ack: true });

async function bindingTag(g: number): Promise<string | null> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ tagId: schema.hubForumDiscordBindings.tagId })
      .from(schema.hubForumDiscordBindings)
      .where(eq(schema.hubForumDiscordBindings.guildId, g)),
    'binding',
  );
  return row.tagId;
}

const tagNames = (channelId: string): string[] =>
  (fake.forums.get(channelId)?.tags ?? []).map((t) => t.name.toLowerCase());

describe('ROK-2258 bind dresses the Discord forum', () => {
  it('a lone hub gets its tag, the forum an Event tag and 👍, no Require tags', async () => {
    const g = await newHub(ctx);
    const forum = fake.put();
    expect((await join(g, forum.id)).status).toBe(200);
    expect(tagNames(forum.id)).toContain('event');
    expect(await bindingTag(g)).not.toBeNull();
    expect(fake.spies.setDefaultReactionIfUnset).toHaveBeenCalledWith(forum.id);
    expect(fake.spies.requireTags).not.toHaveBeenCalled();
  });

  it('reuses an existing Event tag whatever its case', async () => {
    const g = await newHub(ctx);
    const forum = fake.put({ tags: [{ id: '1', name: 'EVENT' }] });
    expect((await join(g, forum.id)).status).toBe(200);
    expect(tagNames(forum.id).filter((n) => n === 'event')).toHaveLength(1);
  });

  it('turns on Require tags once a second hub shares the forum', async () => {
    const forum = fake.put();
    expect((await join(await newHub(ctx), forum.id)).status).toBe(200);
    expect(fake.spies.requireTags).not.toHaveBeenCalled();
    expect((await join(await newHub(ctx), forum.id)).status).toBe(200);
    expect(fake.spies.requireTags).toHaveBeenCalledWith(forum.id);
  });

  it('binds anyway when the forum is at 20 tags (skips, never 409s a lone hub)', async () => {
    const g = await newHub(ctx);
    const tags = Array.from({ length: 20 }, (_, i) => ({
      id: `m${String(i)}`,
      name: `mod ${String(i)}`,
    }));
    const forum = fake.put({ tags });
    expect((await join(g, forum.id)).status).toBe(200);
    expect(tagNames(forum.id)).toHaveLength(20);
    expect(await bindingTag(g)).toBeNull();
  });
});

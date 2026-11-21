/**
 * ROK-2292 §3 — the starter-card backfill against a real database, for
 * event-planning registry posts: only open posts of upcoming events with no
 * starter row are edited; a second run is a no-op; one failing post does
 * not stop the rest. The starter editor and the card builder are spied (no
 * Discord); the bot reports a guild so `record` writes the row. Other specs'
 * rows share the DB, so the run starts after this test's first event and
 * every assertion is scoped to threads this test inserted.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { EMBED_STATES } from '../../../discord-bot/discord-bot.constants';
import { EventForumStarterCards } from '../../../discord-bot/services/event-forum-starter.cards';
import * as schema from '../../../drizzle/schema';
import { ForumStarterEditor } from './forum-starter-edit.port';
import { ForumStarterBackfill } from './forum-starter.backfill';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const posts = schema.eventPlanningPosts;
const rows = schema.discordEventMessages;

let testApp: TestApp;
let forumId: number;

interface Over {
  startInMs?: number;
  cancelled?: boolean;
  adHoc?: boolean;
  locked?: boolean;
  closesInMs?: number;
  rowed?: boolean;
}

/** An event plus its registry post; returns the post's thread id. */
async function newPost(
  over: Over = {},
): Promise<{ eventId: number; threadId: string }> {
  const start = new Date(Date.now() + (over.startInMs ?? 24 * HOUR));
  const [ev] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Backfill Raid',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        isAdHoc: over.adHoc ?? false,
        cancelledAt: over.cancelled ? new Date() : null,
        duration: [start, new Date(start.getTime() + 2 * HOUR)] as [Date, Date],
      })
      .returning(),
    'event',
  );
  const threadId = snowflake();
  await testApp.db.insert(posts).values({
    subjectKind: 'event',
    subjectId: ev.id,
    forumId,
    discordThreadId: threadId,
    closesAt: new Date(Date.now() + (over.closesInMs ?? 30 * HOUR)),
    discordLockedAt: over.locked ? new Date() : null,
  });
  if (over.rowed) {
    await testApp.db.insert(rows).values({
      eventId: ev.id,
      guildId: FAKE_DISCORD_GUILD,
      channelId: threadId,
      messageId: threadId,
      embedState: EMBED_STATES.POSTED,
    });
  }
  return { eventId: ev.id, threadId };
}

function spies() {
  jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'getGuildId')
    .mockReturnValue(FAKE_DISCORD_GUILD);
  jest
    .spyOn(testApp.app.get(EventForumStarterCards), 'build')
    .mockResolvedValue({
      embeds: [],
      components: [],
      state: EMBED_STATES.POSTED,
    });
  return jest
    .spyOn(testApp.app.get(ForumStarterEditor), 'editStarter')
    .mockResolvedValue('edited');
}

async function rowedThreads(threadIds: string[]): Promise<string[]> {
  const got = await testApp.db
    .select({ id: rows.channelId })
    .from(rows)
    .where(
      and(
        inArray(rows.channelId, threadIds),
        eq(rows.channelId, rows.messageId),
      ),
    );
  return got.map((r) => r.id).sort();
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const [f] = nonEmpty(
    await testApp.db
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId: snowflake() })
      .returning(),
    'forum',
  );
  forumId = f.id;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2292 ForumStarterBackfill (registry posts)', () => {
  it('edits only open, upcoming, un-rowed posts; a second run is a no-op', async () => {
    const edit = spies();
    const good = await newPost();
    const skip = [
      await newPost({ startInMs: -HOUR }),
      await newPost({ cancelled: true }),
      await newPost({ adHoc: true }),
      await newPost({ locked: true }),
      await newPost({ closesInMs: -HOUR }),
      await newPost({ rowed: true }),
    ];
    const mine = [good, ...skip].map((p) => p.threadId);
    const svc = testApp.app.get(ForumStarterBackfill);
    await svc.run(good.eventId - 1);
    const edited = edit.mock.calls
      .map((c) => c[0])
      .filter((id) => mine.includes(id));
    expect(edited).toEqual([good.threadId]);
    const rowedNow = skip.filter((p) => p !== skip[5]).map((p) => p.threadId);
    expect(await rowedThreads([good.threadId, ...rowedNow])).toEqual([
      good.threadId,
    ]);
    edit.mockClear();
    await svc.run(good.eventId - 1);
    expect(edit.mock.calls.filter((c) => mine.includes(c[0]))).toEqual([]);
  });

  it('one failing post is skipped (no row); the next is still edited', async () => {
    const edit = spies();
    const a = await newPost();
    const b = await newPost();
    edit.mockImplementation((threadId) =>
      threadId === a.threadId
        ? Promise.reject(
            Object.assign(new Error('Unknown Channel'), { code: 10003 }),
          )
        : Promise.resolve('edited'),
    );
    await expect(
      testApp.app.get(ForumStarterBackfill).run(a.eventId - 1),
    ).resolves.toBeGreaterThanOrEqual(1);
    expect(await rowedThreads([a.threadId, b.threadId])).toEqual([b.threadId]);
  });
});

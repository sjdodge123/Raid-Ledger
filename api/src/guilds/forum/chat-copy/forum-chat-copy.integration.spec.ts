/**
 * ROK-2297 D1 — `copyForumChat` against a real database: what is copied and
 * how (authors, guest columns, timestamps, roots, header, counter), that a
 * re-run and a concurrent run write nothing more, and that a reschedule round
 * trip (event → poll → same event) brings back only the poll's own replies.
 * Every test builds its own hub and threads (no FK from thread to subject).
 */
import { asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { copyForumChat } from './forum-chat-copy.writes';

const threads = schema.hubForumThreads;
const replies = schema.hubForumReplies;
const MIN = 60_000;

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

interface Scene {
  guildId: number;
  userId: number;
  eventThread: number;
  pollThread: number;
  t0: number;
}

async function newHub(tag: string): Promise<number> {
  const name = `Chat Copy ${tag} ${Date.now()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function newThread(
  guildId: number,
  title: string,
  subject: { eventId: number } | { matchId: number },
): Promise<number> {
  const [t] = nonEmpty(
    await testApp.db
      .insert(threads)
      .values({ guildId, title, body: `${title} body`, ...subject })
      .returning(),
    'thread',
  );
  return t.id;
}

async function newScene(): Promise<Scene> {
  seq += 1;
  const tag = `${seq}-${Date.now()}`;
  const guildId = await newHub(tag);
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:chat-copy-${tag}@chat-copy.test`,
        username: `chat-copy-${tag}`,
        displayName: `Chat Copy ${tag}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  const subject = 900_000 + seq;
  return {
    guildId,
    userId: u.id,
    eventThread: await newThread(guildId, 'Raid night', { eventId: subject }),
    pollThread: await newThread(guildId, 'Reschedule poll', {
      matchId: subject,
    }),
    t0: Date.now() - 2 * 86_400_000,
  };
}

type ReplyValues = Omit<typeof replies.$inferInsert, 'threadId' | 'guildId'>;

async function addReply(
  s: Scene,
  threadId: number,
  values: ReplyValues,
): Promise<number> {
  const [r] = nonEmpty(
    await testApp.db
      .insert(replies)
      .values({ threadId, guildId: s.guildId, ...values })
      .returning(),
    'reply',
  );
  return r.id;
}

function rowsOf(threadId: number) {
  return testApp.db
    .select()
    .from(replies)
    .where(eq(replies.threadId, threadId))
    .orderBy(asc(replies.createdAt), asc(replies.id));
}

async function replyCount(threadId: number): Promise<number> {
  const [t] = nonEmpty(
    await testApp.db.select().from(threads).where(eq(threads.id, threadId)),
    'thread',
  );
  return t.replyCount;
}

/** Event thread: a member reply, a guest reply, a signup line, a deleted one. */
async function seedEventChat(s: Scene) {
  const at = (m: number) => new Date(s.t0 + m * MIN);
  const member = await addReply(s, s.eventThread, {
    authorId: s.userId,
    body: 'member says hi',
    createdAt: at(1),
    editedAt: at(2),
  });
  const guest = await addReply(s, s.eventThread, {
    authorDiscordId: '111222333',
    authorDiscordName: 'Guesty',
    authorDiscordAvatar: 'abc123',
    body: 'guest from discord',
    createdAt: at(3),
  });
  await addReply(s, s.eventThread, {
    kind: 'signup_line',
    body: 'Someone signed up',
    createdAt: at(4),
  });
  await addReply(s, s.eventThread, {
    authorId: s.userId,
    body: 'deleted reply',
    createdAt: at(5),
    deletedAt: at(6),
    deletedAs: 'author',
  });
  return { member, guest };
}

const copy = (src: number, dst: number) =>
  copyForumChat(testApp.db, { srcThreadId: src, dstThreadId: dst });

describe('copyForumChat (ROK-2297)', () => {
  it('copies live member + guest replies under one header, originals kept', async () => {
    const s = await newScene();
    const { member, guest } = await seedEventChat(s);
    const before = await replyCount(s.pollThread);

    const result = await copy(s.eventThread, s.pollThread);

    const rows = await rowsOf(s.pollThread);
    expect(rows.map((r) => r.kind)).toEqual(['copy_header', 'reply', 'reply']);
    const [header, m, g] = rows;
    expect(result).toEqual({
      guildId: s.guildId,
      threadId: s.pollThread,
      replyIds: rows.map((r) => r.id),
    });
    expect(header).toMatchObject({
      authorId: null,
      copiedFromThreadId: s.eventThread,
      copiedFromReplyId: null,
      createdAt: new Date(s.t0 + MIN - 1),
    });
    expect(header?.body).toMatch(
      /^Earlier chat from Raid night · 2 messages, /,
    );
    expect(m).toMatchObject({
      authorId: s.userId,
      authorDiscordId: null,
      body: 'member says hi',
      createdAt: new Date(s.t0 + MIN),
      editedAt: new Date(s.t0 + 2 * MIN),
      copiedFromReplyId: member,
      copiedFromThreadId: s.eventThread,
    });
    expect(g).toMatchObject({
      authorId: null,
      authorDiscordId: '111222333',
      authorDiscordName: 'Guesty',
      authorDiscordAvatar: 'abc123',
      body: 'guest from discord',
      createdAt: new Date(s.t0 + 3 * MIN),
      copiedFromReplyId: guest,
    });
    // The header is a system line: only the 2 copies count.
    expect(await replyCount(s.pollThread)).toBe(before + 2);
  });

  it('a second run writes nothing', async () => {
    const s = await newScene();
    await seedEventChat(s);
    expect(await copy(s.eventThread, s.pollThread)).not.toBeNull();
    const count = await replyCount(s.pollThread);

    expect(await copy(s.eventThread, s.pollThread)).toBeNull();

    expect(await rowsOf(s.pollThread)).toHaveLength(3);
    expect(await replyCount(s.pollThread)).toBe(count);
  });

  it('two concurrent runs write one set', async () => {
    const s = await newScene();
    await seedEventChat(s);

    const results = await Promise.all([
      copy(s.eventThread, s.pollThread),
      copy(s.eventThread, s.pollThread),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await rowsOf(s.pollThread)).toHaveLength(3);
    expect(await replyCount(s.pollThread)).toBe(2);
  });

  it('a reschedule round trip brings back only the poll’s own replies', async () => {
    const s = await newScene();
    await seedEventChat(s);
    await copy(s.eventThread, s.pollThread);
    const pollNative = await addReply(s, s.pollThread, {
      authorId: s.userId,
      body: 'in-poll reply',
      createdAt: new Date(s.t0 + 60 * MIN),
    });
    const eventBefore = await rowsOf(s.eventThread);

    const back = await copy(s.pollThread, s.eventThread);

    const added = (await rowsOf(s.eventThread)).filter(
      (r) => !eventBefore.some((b) => b.id === r.id),
    );
    expect(added.map((r) => [r.kind, r.copiedFromReplyId])).toEqual([
      ['copy_header', null],
      ['reply', pollNative],
    ]);
    expect(added[0]?.body).toMatch(/Reschedule poll · 1 message, /);
    expect(back?.replyIds).toEqual(added.map((r) => r.id));
    const bodies = (await rowsOf(s.eventThread)).map((r) => r.body);
    expect(bodies.filter((b) => b === 'member says hi')).toHaveLength(1);
    expect(bodies.filter((b) => b === 'guest from discord')).toHaveLength(1);
  });

  it('nothing copyable ⇒ no header, nothing written', async () => {
    const s = await newScene();
    await addReply(s, s.eventThread, {
      kind: 'signup_line',
      body: 'Only a line',
      createdAt: new Date(s.t0),
    });

    expect(await copy(s.eventThread, s.pollThread)).toBeNull();
    expect(await rowsOf(s.pollThread)).toHaveLength(0);
  });
});

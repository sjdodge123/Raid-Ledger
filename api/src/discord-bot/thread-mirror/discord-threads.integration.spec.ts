/**
 * ROK-1483 — the thread mirror against real Postgres (AC2, AC5, AC10).
 *
 * Three claims live here and nowhere else, because none of them is observable
 * against a drizzle mock:
 *
 *  - **AC5** — the authorization ladder of `GET /discord/threads/:id/messages`.
 *    Every failure is a 403, never a 404, and the caller's CLAIMED surface is
 *    cross-checked against the one the server resolves (D3).
 *  - **AC2** — the backfill is idempotent. `ON CONFLICT DO NOTHING` firing on
 *    `message_id`, `mirror_updated_at` NOT moving on a re-walk, and a
 *    soft-deleted row surviving one, are all database behaviour.
 *  - **AC10** — the read path makes no Discord call. Proved by poisoning every
 *    method of `DiscordBotClientService` except `getGuildId` and still getting
 *    a 200.
 *
 * `sort_key` ordering is here too (D5): a mock cannot tell you that Postgres
 * orders an 18-digit snowflake below a 19-digit one — only a real `ORDER BY`
 * can, and getting it wrong is silent.
 */
import { eq } from 'drizzle-orm';
import type { Client } from 'discord.js';
import type { ThreadMessagesResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import {
  createGame,
  deactivateUser,
} from '../../lfg/lfg.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { insertMirroredMessages } from './thread-mirror.db-helpers';
import { toMirrorRow, type MirrorSourceMessage } from './thread-mirror.helpers';
import { MAX_BACKFILL_MESSAGES } from './thread-mirror.constants';
import { ThreadMirrorService } from './thread-mirror.service';

const GUILD = 'guild-int-1';
const THREAD = '1000000000000000001';
const BOT_USER_ID = 'bot-self-9';

let testApp: TestApp;
let mirror: ThreadMirrorService;
let clientService: DiscordBotClientService;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
  mirror = testApp.app.get(ThreadMirrorService, { strict: false });
  clientService = testApp.app.get(DiscordBotClientService, { strict: false });
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A message shaped exactly as `MirrorSourceMessage` asks — no gateway needed. */
function message(
  id: string,
  overrides: Partial<MirrorSourceMessage> = {},
): MirrorSourceMessage {
  return {
    id,
    content: `message ${id}`,
    createdAt: new Date('2026-02-01T12:00:00.000Z'),
    editedAt: null,
    author: {
      id: `author-${id}`,
      username: `user-${id}`,
      displayName: null,
      avatar: null,
      bot: false,
    },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    ...overrides,
  };
}

/** The `lfg_group_messages` row that makes a thread app-owned (D2 derivation). */
async function seedForumThread(
  gameId: number,
  threadId: string,
): Promise<void> {
  await testApp.db.insert(schema.lfgGroupMessages).values({
    gameId,
    guildId: GUILD,
    channelId: threadId,
    messageId: `starter-${threadId}`,
    threadId,
    postKind: 'forum',
    state: 'open',
  });
}

/** Mirror rows written directly — the read tests need no Discord at all. */
async function seedMirrored(threadId: string, ids: string[]): Promise<void> {
  await insertMirroredMessages(
    testApp.db,
    threadId,
    ids.map((id) => toMirrorRow(message(id), GUILD)),
  );
}

/** Every mirrored row of a thread, oldest first. */
async function rowsFor(
  threadId: string,
): Promise<(typeof schema.discordThreadMessages.$inferSelect)[]> {
  return testApp.db
    .select()
    .from(schema.discordThreadMessages)
    .where(eq(schema.discordThreadMessages.threadId, threadId))
    .orderBy(schema.discordThreadMessages.sortKey);
}

/**
 * Stand a fake Discord client in front of the backfill.
 *
 * Pages newest-first from `before`, exactly as `thread.messages.fetch` does,
 * so the cap test measures the real paging arithmetic.
 *
 * @param available - Every message the thread contains, any order.
 * @returns The `messages.fetch` mock, so a test can count its calls.
 */
function mockDiscordThread(available: MirrorSourceMessage[]): jest.Mock {
  const newestFirst = [...available].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? 1 : -1,
  );
  const fetch = jest.fn((options: { limit: number; before?: string }) => {
    const older =
      options.before === undefined
        ? newestFirst
        : newestFirst.filter((m) => BigInt(m.id) < BigInt(options.before!));
    const page = older.slice(0, options.limit);
    return Promise.resolve(
      new Map(page.map((m) => [m.id, m])) as ReadonlyMap<
        string,
        MirrorSourceMessage
      >,
    );
  });
  const thread = { isThread: () => true, messages: { fetch } };
  const client = {
    user: { id: BOT_USER_ID },
    channels: { fetch: jest.fn().mockResolvedValue(thread) },
  };
  jest
    .spyOn(clientService, 'getClient')
    .mockReturnValue(client as unknown as Client);
  return fetch;
}

/** Run the bind hook for a thread, the way `postForum`'s BOUND event does. */
async function backfill(gameId: number, threadId = THREAD): Promise<void> {
  await mirror.ensureBackfilled({
    threadId,
    guildId: GUILD,
    surfaceKind: 'lfg-group',
    surfaceId: String(gameId),
  });
}

async function getThread(
  token: string | null,
  threadId: string,
  query: string,
): Promise<{ status: number; body: ThreadMessagesResponseDto }> {
  const req = testApp.request.get(
    `/discord/threads/${threadId}/messages?${query}`,
  );
  const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return { status: res.status, body: res.body as ThreadMessagesResponseDto };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — the authorization ladder
// ═══════════════════════════════════════════════════════════════════════════

describe('AC5 — GET /discord/threads/:threadId/messages', () => {
  it('401s an unauthenticated caller', async () => {
    const game = await createGame(testApp, 'Guarded Thread');
    await seedForumThread(game.id, THREAD);

    // MUTATION: drop `AuthGuard('jwt')` from the controller's class-level
    // @UseGuards — this must then return 200.
    const res = await getThread(
      null,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );
    expect(res.status).toBe(401);
  });

  it('403s when the claimed surface is not the one the server resolved', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'claimant',
      'claimant@test.local',
    );
    const owner = await createGame(testApp, 'Owning Game');
    const other = await createGame(testApp, 'Other Game');
    await seedForumThread(owner.id, THREAD);
    await seedMirrored(THREAD, ['1000000000000000002']);

    // MUTATION: delete the `surface.id !== query.surfaceId` half of the
    // comparison in ThreadMirrorService.getMessages — this becomes a 200.
    const res = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${other.id}`,
    );
    expect(res.status).toBe(403);
  });

  it('403s — not 404s — a thread the app does not own', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'stranger',
      'stranger@test.local',
    );
    const game = await createGame(testApp, 'Unbound Game');

    // MUTATION: delete `if (!surface) throw new ForbiddenException(...)` in
    // getMessages — the request then 500s on a null surface instead.
    const res = await getThread(
      token,
      '1000000000000000999',
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );
    expect(res.status).toBe(403);
  });

  it('200s the correct claim with ascending messages and the deep link', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'reader',
      'reader@test.local',
    );
    const game = await createGame(testApp, 'Readable Game');
    await seedForumThread(game.id, THREAD);
    await seedMirrored(THREAD, [
      '1000000000000000030',
      '1000000000000000010',
      '1000000000000000020',
    ]);

    const res = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );

    expect(res.status).toBe(200);
    // MUTATION: drop the `.reverse()` in getMessages — the ids arrive
    // descending and this fails naming both orders.
    expect(res.body.messages.map((m) => m.messageId)).toEqual([
      '1000000000000000010',
      '1000000000000000020',
      '1000000000000000030',
    ]);
    expect(res.body.threadUrl).toBe(
      `https://discord.com/channels/${GUILD}/${THREAD}`,
    );
    expect(res.body.surface).toEqual({
      kind: 'lfg-group',
      id: String(game.id),
    });
    expect(res.body.hasMore).toBe(false);
  });

  it('403s a deactivated member holding a correct claim', async () => {
    const { token, userId } = await createMemberAndLogin(
      testApp,
      'departed',
      'departed@test.local',
    );
    const game = await createGame(testApp, 'Deactivated Reader Game');
    await seedForumThread(game.id, THREAD);
    await deactivateUser(testApp, userId);

    // MUTATION: remove NotDeactivatedGuard from the controller's @UseGuards —
    // this becomes a 200.
    const res = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );
    expect(res.status).toBe(403);
  });

  it('400s a surface kind that is not in the enum and a limit over the max', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'overreacher',
      'overreacher@test.local',
    );
    const game = await createGame(testApp, 'Boundary Game');
    await seedForumThread(game.id, THREAD);

    // MUTATION: add 'lineup' to ThreadSurfaceKindSchema / drop `.max(100)`
    // from ThreadMessagesQuerySchema — each of these becomes a 403 or a 200.
    const kind = await getThread(
      token,
      THREAD,
      `surfaceKind=lineup&surfaceId=${game.id}`,
    );
    const limit = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}&limit=101`,
    );
    expect(kind.status).toBe(400);
    expect(limit.status).toBe(400);
  });

  it('400s a `before` that is not a snowflake, rather than 500ing inside BigInt()', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'cursor-abuser',
      'cursor-abuser@test.local',
    );
    const game = await createGame(testApp, 'Cursor Guard Game');
    await seedForumThread(game.id, THREAD);

    // MUTATION: relax `before` back to `z.string().optional()` in
    // ThreadMessagesQuerySchema — `snowflakeToSortKey` then evaluates
    // BigInt('abc'), which throws SyntaxError, and this fails with
    // `expected 400, received 500`.
    const res = await testApp.request
      .get(
        `/discord/threads/${THREAD}/messages?surfaceKind=lfg-group&surfaceId=${game.id}&before=abc`,
      )
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    // `BadRequestException(fieldErrors)` serialises the object AS the body
    // (flat), the same shape ROK-1474's A18 case pinned — not nested under
    // `message`.
    expect((res.body as { before?: string[] }).before).toEqual([
      'before must be a Discord message id',
    ]);
  });

  it('pages backwards through `before`, flipping hasMore on the last page', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'pager',
      'pager@test.local',
    );
    const game = await createGame(testApp, 'Paged Game');
    await seedForumThread(game.id, THREAD);
    await seedMirrored(THREAD, [
      '1000000000000000010',
      '1000000000000000020',
      '1000000000000000030',
    ]);

    const first = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}&limit=2`,
    );
    const older = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}&limit=2&before=${first.body.messages[0].messageId}`,
    );

    expect(first.body.messages.map((m) => m.messageId)).toEqual([
      '1000000000000000020',
      '1000000000000000030',
    ]);
    expect(first.body.hasMore).toBe(true);
    // MUTATION: drop the `lt(sortKey, snowflakeToSortKey(before))` cursor from
    // listMirroredMessages — the second page repeats the newest two ids and
    // this fails naming ['1000000000000000020','1000000000000000030'] against
    // ['1000000000000000010'].
    expect(older.body.messages.map((m) => m.messageId)).toEqual([
      '1000000000000000010',
    ]);
    expect(older.body.hasMore).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — the backfill is idempotent, capped and delete-safe
// ═══════════════════════════════════════════════════════════════════════════

describe('AC2 — ensureBackfilled', () => {
  const THREE = [
    '1000000000000000010',
    '1000000000000000020',
    '1000000000000000030',
  ];

  it('mirrors every message once', async () => {
    const game = await createGame(testApp, 'Backfilled Game');
    await seedForumThread(game.id, THREAD);
    mockDiscordThread(THREE.map((id) => message(id)));

    await backfill(game.id);

    expect((await rowsFor(THREAD)).map((r) => r.messageId)).toEqual(THREE);
  });

  it('is a no-op the second time — no new rows, no mirror_updated_at moved', async () => {
    const game = await createGame(testApp, 'Re-walked Game');
    await seedForumThread(game.id, THREAD);
    mockDiscordThread(THREE.map((id) => message(id)));
    await backfill(game.id);
    const before = (await rowsFor(THREAD)).map((r) =>
      r.mirrorUpdatedAt.toISOString(),
    );

    await backfill(game.id);

    const after = await rowsFor(THREAD);
    expect(after).toHaveLength(3);
    // MUTATION: swap `insertMirroredMessages` for `upsertMirroredMessage` in
    // ThreadMirrorService.backfill — every timestamp then moves.
    expect(after.map((r) => r.mirrorUpdatedAt.toISOString())).toEqual(before);
  });

  it('never resurrects a soft-deleted message', async () => {
    const game = await createGame(testApp, 'Deleted Message Game');
    await seedForumThread(game.id, THREAD);
    mockDiscordThread(THREE.map((id) => message(id)));
    await backfill(game.id);
    await testApp.db
      .update(schema.discordThreadMessages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.discordThreadMessages.messageId, THREE[1]));

    await backfill(game.id);

    const rows = await rowsFor(THREAD);
    const revived = rows.find((r) => r.messageId === THREE[1]);
    // MUTATION: make the backfill upsert instead of conflict-do-nothing, or
    // hard-delete instead of soft-delete — the row comes back visible.
    expect(revived?.deletedAt).not.toBeNull();
    expect(rows).toHaveLength(3);
  });

  it('stops at the cap — 250 available, 200 written, two fetches', async () => {
    const game = await createGame(testApp, 'Chatty Game');
    await seedForumThread(game.id, THREAD);
    const available = Array.from({ length: 250 }, (_, i) =>
      message(String(1000000000001000000n + BigInt(i))),
    );
    const fetch = mockDiscordThread(available);

    await backfill(game.id);

    // MUTATION: raise MAX_BACKFILL_MESSAGES, or drop the `collected.length <
    // MAX` loop condition — the count and the call count both climb.
    expect(await rowsFor(THREAD)).toHaveLength(MAX_BACKFILL_MESSAGES);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('orders an 18-digit snowflake BELOW a 19-digit one (D5)', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'sorter',
      'sorter@test.local',
    );
    const game = await createGame(testApp, 'Snowflake Boundary Game');
    await seedForumThread(game.id, THREAD);
    // '9…' sorts AFTER '10…' as a string and BEFORE it as a number.
    await seedMirrored(THREAD, ['999999999999999999', '1000000000000000000']);

    const res = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );

    // MUTATION: order `listMirroredMessages` by `messageId` instead of
    // `sortKey` — the two ids swap and this names both orders.
    expect(res.body.messages.map((m) => m.messageId)).toEqual([
      '999999999999999999',
      '1000000000000000000',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC10 — the read path never calls Discord
// ═══════════════════════════════════════════════════════════════════════════

describe('AC10 — no Discord call on the read path', () => {
  /**
   * Poison every method of the client except `getGuildId`, which D1 allows as
   * the fallback for a thread with nothing mirrored yet. Iterating the
   * prototype rather than naming methods means a method added later is
   * poisoned too, so this guard cannot rot.
   */
  function poisonDiscordClient(): void {
    const methods = clientService as unknown as Record<string, () => unknown>;
    const proto = Object.getPrototypeOf(clientService) as object;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name === 'getGuildId') continue;
      if (typeof methods[name] !== 'function') continue;
      jest.spyOn(methods, name).mockImplementation(() => {
        throw new Error(
          `AC10 violated: the read path called DiscordBotClientService.${name}`,
        );
      });
    }
  }

  it('200s with the Discord client throwing on every call but getGuildId', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'offline',
      'offline@test.local',
    );
    const game = await createGame(testApp, 'Offline Game');
    await seedForumThread(game.id, THREAD);
    await seedMirrored(THREAD, ['1000000000000000040']);
    poisonDiscordClient();

    // MUTATION: add any `this.clientService.getClient()` call to getMessages —
    // the poisoned method throws and this 500s.
    const res = await getThread(
      token,
      THREAD,
      `surfaceKind=lfg-group&surfaceId=${game.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.threadUrl).toBe(
      `https://discord.com/channels/${GUILD}/${THREAD}`,
    );
  });
});

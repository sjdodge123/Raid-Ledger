/**
 * ROK-1483 — unit cover for the thread mirror's write half and its three 403s.
 *
 * The db helpers are mocked as a module: what matters here is WHICH helper the
 * service reaches for (bulk conflict-do-nothing on a backfill, upsert on a
 * live edit) and with what rows — the SQL those helpers emit is only
 * observable against a real Postgres and is pinned in the integration spec.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ThreadSurfaceRef } from '@raid-ledger/contract';
import { MAX_BACKFILL_MESSAGES } from './thread-mirror.constants';
import {
  hasAnyMirrored,
  insertMirroredMessages,
  listMirroredMessages,
  softDeleteMirroredMessage,
  upsertMirroredMessage,
} from './thread-mirror.db-helpers';
import type {
  MirroredMessageRow,
  MirroredMessageValues,
  MirrorSourceMessage,
} from './thread-mirror.helpers';
import { ThreadMirrorService } from './thread-mirror.service';
import type { ThreadSurfaceRegistry } from './thread-surface.registry';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ThreadMirrorDb } from './thread-mirror.db-helpers';

jest.mock('./thread-mirror.db-helpers');

const mockInsert = insertMirroredMessages as jest.MockedFunction<
  typeof insertMirroredMessages
>;
const mockUpsert = upsertMirroredMessage as jest.MockedFunction<
  typeof upsertMirroredMessage
>;
const mockSoftDelete = softDeleteMirroredMessage as jest.MockedFunction<
  typeof softDeleteMirroredMessage
>;
const mockList = listMirroredMessages as jest.MockedFunction<
  typeof listMirroredMessages
>;
const mockHasAny = hasAnyMirrored as jest.MockedFunction<typeof hasAnyMirrored>;

const BOT_ID = '1000000000000000001';
const GUILD = '2000000000000000002';
const THREAD = '3000000000000000003';

/** A structurally-typed gateway message; overrides win. */
function message(
  id: string,
  over: Partial<MirrorSourceMessage> = {},
): MirrorSourceMessage {
  return {
    id,
    content: `body ${id}`,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    editedAt: null,
    author: {
      id: '9000000000000000009',
      username: 'ann',
      displayName: 'Ann',
      avatar: null,
      bot: false,
    },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    ...over,
  };
}

/** `n` messages with ascending snowflakes. */
function messages(n: number): MirrorSourceMessage[] {
  return Array.from({ length: n }, (_, i) =>
    message(String(4000000000000000000n + BigInt(i))),
  );
}

describe('ThreadMirrorService', () => {
  let service: ThreadMirrorService;
  let fetchMessages: jest.Mock;
  let channelsFetch: jest.Mock;
  let registry: jest.Mocked<
    Pick<
      ThreadSurfaceRegistry,
      'resolveSurface' | 'canView' | 'listActiveThreads'
    >
  >;
  let getGuildId: jest.Mock;

  /** Make `thread.messages.fetch` page backwards through `pool`. */
  function serve(pool: MirrorSourceMessage[]): void {
    const newestFirst = [...pool].reverse();
    fetchMessages.mockImplementation(
      ({ limit, before }: { limit: number; before?: string }) => {
        const start =
          before === undefined
            ? 0
            : newestFirst.findIndex((m) => m.id === before) + 1;
        const page = newestFirst.slice(start, start + limit);
        return Promise.resolve(new Map(page.map((m) => [m.id, m])));
      },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockHasAny.mockResolvedValue(false);
    fetchMessages = jest.fn();
    getGuildId = jest.fn().mockReturnValue(GUILD);
    channelsFetch = jest.fn().mockResolvedValue({
      isThread: () => true,
      messages: { fetch: fetchMessages },
    });
    const client = {
      user: { id: BOT_ID },
      channels: { fetch: channelsFetch },
    };
    registry = {
      resolveSurface: jest.fn(),
      canView: jest.fn().mockResolvedValue(true),
      listActiveThreads: jest.fn().mockResolvedValue([]),
    };
    service = new ThreadMirrorService(
      {} as ThreadMirrorDb,
      {
        getClient: () => client,
        getGuildId,
      } as unknown as DiscordBotClientService,
      registry as unknown as ThreadSurfaceRegistry,
    );
  });

  /** The rows handed to the LAST `insertMirroredMessages` call. */
  function insertedRows(): MirroredMessageValues[] {
    const call = mockInsert.mock.calls.at(-1);
    return call?.[2] ?? [];
  }

  const bound = {
    threadId: THREAD,
    guildId: GUILD,
    surfaceKind: 'lfg-group' as const,
    surfaceId: '7',
  };

  describe('backfill (AC2, D13)', () => {
    it('inserts every message oldest-first through the conflict-do-nothing bulk helper', async () => {
      serve(messages(3));
      await service.ensureBackfilled(bound);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(insertedRows().map((r) => r.messageId)).toEqual([
        '4000000000000000000',
        '4000000000000000001',
        '4000000000000000002',
      ]);
    });

    it('never reaches for the upsert, so a second backfill moves no mirror_updated_at', async () => {
      serve(messages(3));
      await service.ensureBackfilled(bound);
      await service.ensureBackfilled(bound);

      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(insertedRows()).toHaveLength(3);
    });

    it('stops at MAX_BACKFILL_MESSAGES after exactly two fetch pages', async () => {
      serve(messages(250));
      await service.ensureBackfilled(bound);

      expect(fetchMessages).toHaveBeenCalledTimes(2);
      expect(insertedRows()).toHaveLength(MAX_BACKFILL_MESSAGES);
    });

    it('skips this app’s own bot but mirrors a DIFFERENT bot (A1b)', async () => {
      const own = message('4000000000000000010', {
        author: {
          id: BOT_ID,
          username: 'raid-ledger',
          displayName: null,
          avatar: null,
          bot: true,
        },
      });
      const otherBot = message('4000000000000000011', {
        author: {
          id: '5000000000000000005',
          username: 'companion',
          displayName: null,
          avatar: null,
          bot: true,
        },
      });
      serve([own, otherBot]);

      await service.ensureBackfilled(bound);

      expect(insertedRows().map((r) => r.messageId)).toEqual([
        '4000000000000000011',
      ]);
    });

    it('reconciles every live thread the registry reports (D14)', async () => {
      registry.listActiveThreads.mockResolvedValue([
        { threadId: THREAD, guildId: GUILD },
      ]);
      serve(messages(1));

      await service.reconcile();

      expect(mockInsert).toHaveBeenCalledWith(
        expect.anything(),
        THREAD,
        expect.arrayContaining([
          expect.objectContaining({ messageId: '4000000000000000000' }),
        ]),
      );
    });

    it('skips a thread that already has mirrored rows instead of re-walking it', async () => {
      registry.listActiveThreads.mockResolvedValue([
        { threadId: THREAD, guildId: GUILD },
      ]);
      mockHasAny.mockResolvedValue(true);

      await service.reconcile();

      // MUTATION: drop the `hasAnyMirrored` short-circuit from `reconcile` and
      // this fails with `expect(jest.fn()).not.toHaveBeenCalled() ... Number
      // of calls: 1` — every reconnect would re-walk every open thread at up
      // to three Discord REST calls each.
      expect(mockHasAny).toHaveBeenCalledWith(expect.anything(), THREAD);
      expect(channelsFetch).not.toHaveBeenCalled();
      expect(fetchMessages).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('live gateway writes (AC1, D6)', () => {
    it('upserts a created message with its snowflake sort key', async () => {
      await service.onMessageCreate(
        message('4000000000000000020'),
        THREAD,
        GUILD,
      );

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.anything(),
        THREAD,
        expect.objectContaining({
          messageId: '4000000000000000020',
          sortKey: 4000000000000000020n,
          authorDisplayName: 'Ann',
        }),
      );
    });

    it('fetches a partial update exactly once and upserts the fetched content', async () => {
      const fetched = message('4000000000000000021', {
        content: 'edited',
        editedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      const fetch = jest.fn().mockResolvedValue(fetched);

      await service.onMessageUpdate(
        { id: fetched.id, partial: true, fetch },
        THREAD,
        GUILD,
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.anything(),
        THREAD,
        expect.objectContaining({
          content: 'edited',
          editedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );
    });

    it('soft-deletes instead of retrying when the update fetch says Unknown Message', async () => {
      const fetch = jest.fn().mockRejectedValue(new Error('Unknown Message'));

      await service.onMessageUpdate(
        { id: '4000000000000000022', partial: true, fetch },
        THREAD,
        GUILD,
      );

      expect(mockUpsert).not.toHaveBeenCalled();
      expect(mockSoftDelete).toHaveBeenCalledWith(
        expect.anything(),
        '4000000000000000022',
      );
    });

    it('drops an own-bot message a partial update resolves to (D9)', async () => {
      const own = message('4000000000000000024', {
        author: {
          id: BOT_ID,
          username: 'raid-ledger',
          displayName: null,
          avatar: null,
          bot: true,
        },
      });
      const fetch = jest.fn().mockResolvedValue(own);

      // MUTATION: drop the post-fetch `isOwnBotMessage` guard in
      // `onMessageUpdate` and this fails with
      // `expect(jest.fn()).not.toHaveBeenCalled() ... Number of calls: 1` —
      // the board's own starter embed would be mirrored on every roster edit.
      await service.onMessageUpdate(
        { id: own.id, partial: true, fetch },
        THREAD,
        GUILD,
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('soft-deletes a delete by id and NEVER fetches it', async () => {
      const fetch = jest.fn();

      await service.onMessageDelete({
        id: '4000000000000000023',
        fetch,
      } as unknown as { id: string });

      expect(fetch).not.toHaveBeenCalled();
      expect(mockSoftDelete).toHaveBeenCalledWith(
        expect.anything(),
        '4000000000000000023',
      );
    });
  });

  describe('getMessages authorization (AC5, D3)', () => {
    const query = {
      surfaceKind: 'lfg-group' as const,
      surfaceId: '7',
      limit: 50,
    };

    it('403s a thread no surface owns', async () => {
      registry.resolveSurface.mockResolvedValue(null);

      await expect(
        service.getMessages(1, THREAD, query),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockList).not.toHaveBeenCalled();
    });

    it('403s when the claimed surface is not the resolved one', async () => {
      registry.resolveSurface.mockResolvedValue({
        kind: 'lfg-group',
        id: '8',
      } satisfies ThreadSurfaceRef);

      await expect(
        service.getMessages(1, THREAD, query),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockList).not.toHaveBeenCalled();
    });

    it('403s when the surface says the caller cannot view it', async () => {
      registry.resolveSurface.mockResolvedValue({
        kind: 'lfg-group',
        id: '7',
      });
      registry.canView.mockResolvedValue(false);

      await expect(
        service.getMessages(1, THREAD, query),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockList).not.toHaveBeenCalled();
    });
  });

  describe('getMessages paging (D11, AC10)', () => {
    /** A stored row, only the columns the DTO reads. */
    function row(id: string): MirroredMessageRow {
      return {
        id: `row-${id}`,
        threadId: THREAD,
        messageId: id,
        sortKey: BigInt(id),
        deletedAt: null,
        mirrorUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        guildId: GUILD,
        authorDiscordId: '9000000000000000009',
        authorDisplayName: 'Ann',
        authorAvatarHash: null,
        content: `body ${id}`,
        attachments: [],
        mentions: [],
        discordCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        editedAt: null,
      };
    }

    beforeEach(() => {
      registry.resolveSurface.mockResolvedValue({
        kind: 'lfg-group',
        id: '7',
      });
    });

    it('drops the probe row, reports hasMore and renders ascending', async () => {
      mockList.mockResolvedValue([
        row('4000000000000000003'),
        row('4000000000000000002'),
        row('4000000000000000001'),
      ]);

      const result = await service.getMessages(1, THREAD, {
        surfaceKind: 'lfg-group',
        surfaceId: '7',
        limit: 2,
      });

      expect(result.hasMore).toBe(true);
      expect(result.messages.map((m) => m.messageId)).toEqual([
        '4000000000000000002',
        '4000000000000000003',
      ]);
      expect(result.threadUrl).toBe(
        `https://discord.com/channels/${GUILD}/${THREAD}`,
      );
      expect(getGuildId).not.toHaveBeenCalled();
    });

    it('falls back to getGuildId only when nothing is mirrored yet', async () => {
      mockList.mockResolvedValue([]);

      const result = await service.getMessages(1, THREAD, {
        surfaceKind: 'lfg-group',
        surfaceId: '7',
        limit: 50,
      });

      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(getGuildId).toHaveBeenCalledTimes(1);
      expect(result.threadUrl).toBe(
        `https://discord.com/channels/${GUILD}/${THREAD}`,
      );
    });
  });
});

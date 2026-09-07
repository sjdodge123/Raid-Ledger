import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DemoTestThreadMirrorController } from './demo-test-thread-mirror.controller';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { snowflakeToSortKey } from '../discord-bot/thread-mirror/thread-mirror.helpers';

jest.mock('../discord-bot/thread-mirror/thread-mirror.db-helpers', () => ({
  insertMirroredMessages: jest.fn().mockResolvedValue(undefined),
}));
import { insertMirroredMessages } from '../discord-bot/thread-mirror/thread-mirror.db-helpers';

const insertMock = insertMirroredMessages as jest.MockedFunction<
  typeof insertMirroredMessages
>;

const THREAD_ID = '1400000000000000001';
const MESSAGE_ID = '1400000000000000099';

function seedBody(overrides: Record<string, unknown> = {}) {
  return {
    threadId: THREAD_ID,
    surfaceKind: 'lfg-group',
    surfaceId: '42',
    messages: [
      {
        messageId: MESSAGE_ID,
        authorDiscordId: '900000000000000001',
        authorDisplayName: 'Smoke Companion',
        content: 'hello from the companion bot',
      },
    ],
    ...overrides,
  };
}

describe('DemoTestThreadMirrorController', () => {
  let controller: DemoTestThreadMirrorController;
  let db: MockDb;
  let getDemoMode: jest.Mock;
  const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

  beforeEach(async () => {
    insertMock.mockClear().mockResolvedValue(undefined);
    process.env.DEMO_MODE = 'true';
    db = createDrizzleMock();
    // No pre-existing `lfg_group_messages` row unless a test says otherwise.
    db.limit.mockResolvedValue([]);
    db.returning.mockResolvedValue([]);
    getDemoMode = jest.fn().mockResolvedValue(true);

    const module = await Test.createTestingModule({
      controllers: [DemoTestThreadMirrorController],
      providers: [
        { provide: SettingsService, useValue: { getDemoMode } },
        { provide: DrizzleAsyncProvider, useValue: db },
      ],
    }).compile();

    controller = module.get(DemoTestThreadMirrorController);
  });

  afterEach(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  });

  describe('the DEMO_MODE gate', () => {
    it('rejects when the DEMO_MODE env var is not "true"', async () => {
      process.env.DEMO_MODE = 'false';
      await expect(controller.seedThreadMirror(seedBody())).rejects.toThrow(
        ForbiddenException,
      );
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects when the demo-mode SETTING is off even with the env var on', async () => {
      getDemoMode.mockResolvedValue(false);
      await expect(controller.seedThreadMirror(seedBody())).rejects.toThrow(
        ForbiddenException,
      );
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe('body validation', () => {
    it('rejects a surfaceKind other than lfg-group', async () => {
      await expect(
        controller.seedThreadMirror(seedBody({ surfaceKind: 'lineup' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-numeric surfaceId', async () => {
      await expect(
        controller.seedThreadMirror(seedBody({ surfaceId: 'not-a-game' })),
      ).rejects.toThrow(BadRequestException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('rejects a missing threadId', async () => {
      await expect(
        controller.seedThreadMirror(seedBody({ threadId: '' })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('write (a): the lfg_group_messages binding', () => {
    it('inserts an open forum row when the game has none — this is what makes the thread app-owned', async () => {
      await controller.seedThreadMirror(seedBody({ guildId: '777' }));

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 42,
          guildId: '777',
          threadId: THREAD_ID,
          channelId: THREAD_ID,
          postKind: 'forum',
          state: 'open',
        }),
      );
    });

    it('stamps thread_id + post_kind onto the existing open row instead of inserting a second one', async () => {
      db.limit.mockResolvedValue([{ id: 'row-1', guildId: 'guild-from-row' }]);

      const result = await controller.seedThreadMirror(seedBody());

      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: THREAD_ID,
          channelId: THREAD_ID,
          postKind: 'forum',
        }),
      );
      // The existing row's guild wins so the seeded thread URL matches the group.
      expect(result.guildId).toBe('guild-from-row');
    });
  });

  describe('write (b): the mirror rows', () => {
    it('inserts one mirror row per message with sort_key derived from the message id', async () => {
      const result = await controller.seedThreadMirror(
        seedBody({ guildId: '777' }),
      );

      expect(insertMock).toHaveBeenCalledTimes(1);
      const [, threadId, values] = insertMock.mock.calls[0];
      expect(threadId).toBe(THREAD_ID);
      expect(values).toHaveLength(1);
      expect(values[0]).toEqual(
        expect.objectContaining({
          messageId: MESSAGE_ID,
          guildId: '777',
          authorDiscordId: '900000000000000001',
          authorDisplayName: 'Smoke Companion',
          content: 'hello from the companion bot',
          sortKey: snowflakeToSortKey(MESSAGE_ID),
        }),
      );
      expect(result.mirrored).toBe(1);
    });

    it('honours an explicit createdAt so ordering is seedable', async () => {
      await controller.seedThreadMirror(
        seedBody({
          messages: [
            {
              messageId: MESSAGE_ID,
              authorDiscordId: '9',
              authorDisplayName: 'A',
              content: 'x',
              createdAt: '2026-01-02T03:04:05.000Z',
            },
          ],
        }),
      );

      const [, , values] = insertMock.mock.calls[0];
      expect(values[0].discordCreatedAt).toEqual(
        new Date('2026-01-02T03:04:05.000Z'),
      );
    });
  });

  describe('unbind tears the whole seam down', () => {
    it('deletes the mirror rows AND the fabricated binding row', async () => {
      db.returning.mockResolvedValue([{ id: 'a' }]);

      const result = await controller.seedThreadMirror(
        seedBody({ messages: null, unbind: true }),
      );

      // Two deletes: the mirror rows, then the lfg_group_messages binding.
      // Leaving the binding would collide with uq_lfg_group_messages_game_open
      // on the next real LFM post for this game.
      expect(db.delete).toHaveBeenCalledTimes(2);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(result.cleared).toBe(1);
      // No binding survives, so no guild is claimed.
      expect(result.guildId).toBe('');
    });
  });

  describe('messages: null clears the mirror', () => {
    it('hard-deletes the thread rows and inserts nothing', async () => {
      db.returning.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const result = await controller.seedThreadMirror(
        seedBody({ messages: null }),
      );

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(insertMock).not.toHaveBeenCalled();
      expect(result.cleared).toBe(2);
      expect(result.mirrored).toBe(0);
    });

    it('still binds the thread so the empty state is reachable, not a 403', async () => {
      await controller.seedThreadMirror(seedBody({ messages: null }));
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });
});

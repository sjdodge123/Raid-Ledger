/**
 * ROK-1541 — the thread-membership listener at unit scale: which event adds
 * whom, the AC3 "a manual leaver is not re-added" guarantee, the board-off /
 * archived / text-row guards, and a failing Discord that warns once.
 */
import { Logger } from '@nestjs/common';
import { LfgBoardThreadMembersService } from './lfg-board-thread-members.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { SettingsService } from '../../settings/settings.service';
import type { LfgGameChainService } from './lfg-game-chain.service';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import * as store from '../lfm/lfm-embed.db-helpers';
import * as members from './lfg-board-thread-members.db-helpers';
import * as boardSetting from '../../settings/settings-lfg-board.helpers';

jest.mock('../lfm/lfm-embed.db-helpers');
jest.mock('./lfg-board-thread-members.db-helpers');
jest.mock('../../settings/settings-lfg-board.helpers');

const findOpen = jest.mocked(store.findOpenLfmMessage);
const roster = jest.mocked(members.readRosterUserIds);
const discordIds = jest.mocked(members.loadDiscordIds);
const boardEnabled = jest.mocked(boardSetting.getLfgBoardEnabled);

const GAME_ID = 7;
/** user id -> linked discord id. User 4 has no Discord link. */
const LINKS: Record<number, string | null> = {
  1: '101',
  2: '102',
  3: '103',
  4: null,
};

function forumRow(over: Partial<LfmMessageRow> = {}): LfmMessageRow {
  return {
    id: 'row-1',
    gameId: GAME_ID,
    channelId: 'thread-1',
    threadId: 'thread-1',
    messageId: 'starter',
    postKind: 'forum',
    ...over,
  } as LfmMessageRow;
}

function makeThread(over: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    archived: false,
    memberCount: 3,
    isThread: () => true,
    members: {
      add: jest.fn(() => Promise.resolve('ok')),
      remove: jest.fn(() => Promise.resolve('ok')),
    },
    ...over,
  };
}

let thread: ReturnType<typeof makeThread>;
const guild = { channels: { fetch: jest.fn(() => Promise.resolve(thread)) } };
const client = {
  isConnected: jest.fn(() => true),
  getGuild: jest.fn(() => guild),
};
const chain = {
  serialized: jest.fn((_gameId: number, work: () => Promise<void>) => work()),
};

function service(): LfgBoardThreadMembersService {
  return new LfgBoardThreadMembersService(
    {} as never,
    client as unknown as DiscordBotClientService,
    {} as SettingsService,
    chain as unknown as LfgGameChainService,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  thread = makeThread();
  findOpen.mockResolvedValue(forumRow());
  boardEnabled.mockResolvedValue(true);
  roster.mockResolvedValue(new Set([1, 2]));
  discordIds.mockImplementation((_db, ids) =>
    Promise.resolve(ids.map((id) => ({ discordId: LINKS[id] ?? null }))),
  );
});

describe('the post itself (THREAD_MIRROR bound)', () => {
  it('adds every linked member of the live roster', async () => {
    roster.mockResolvedValue(new Set([1, 2, 4]));
    await service().onThreadBound({
      threadId: 'thread-1',
      guildId: 'g',
      surfaceKind: 'lfg-group',
      surfaceId: String(GAME_ID),
    });
    expect(thread.members.add.mock.calls).toEqual([['101'], ['102']]);
  });

  it('ignores threads bound for other surfaces', async () => {
    await service().onThreadBound({
      threadId: 'thread-9',
      guildId: 'g',
      surfaceKind: 'lineup' as never,
      surfaceId: '1',
    });
    expect(roster).not.toHaveBeenCalled();
    expect(thread.members.add).not.toHaveBeenCalled();
  });
});

describe('membership changes', () => {
  it('adds only the joiner — a roster member who left the thread by hand is not re-added (AC3)', async () => {
    roster.mockResolvedValue(new Set([1, 2, 3]));
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
      userIds: [3],
    });
    expect(thread.members.add.mock.calls).toEqual([['103']]);
  });

  it('adds the hand that completed the pair on LFM_REACHED', async () => {
    await service().onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
      userId: 2,
    });
    expect(thread.members.add.mock.calls).toEqual([['102']]);
  });

  it('removes a withdrawer and touches nobody else (AC2)', async () => {
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'withdrawn',
      userIds: [3],
    });
    expect(thread.members.remove.mock.calls).toEqual([['103']]);
    expect(thread.members.add).not.toHaveBeenCalled();
  });

  it.each(['bumped', 'converted', 'expired', 'playing'] as const)(
    'never re-renders membership on %s',
    async (reason) => {
      await service().onGroupChanged({ gameId: GAME_ID, reason });
      expect(guild.channels.fetch).not.toHaveBeenCalled();
    },
  );

  it('does nothing when the board is off (ROK-1523 retired post)', async () => {
    boardEnabled.mockResolvedValue(false);
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
      userIds: [3],
    });
    expect(thread.members.add).not.toHaveBeenCalled();
  });

  it('does nothing to an archived post', async () => {
    thread = makeThread({ archived: true });
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
      userIds: [3],
    });
    expect(thread.members.add).not.toHaveBeenCalled();
  });

  it('does nothing for a text-board row or no row', async () => {
    findOpen.mockResolvedValueOnce(forumRow({ postKind: 'text' }));
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
      userIds: [3],
    });
    findOpen.mockResolvedValueOnce(null);
    await service().onGroupChanged({
      gameId: GAME_ID,
      reason: 'joined',
      userIds: [3],
    });
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('warns ONCE and never throws when Discord refuses', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    guild.channels.fetch.mockRejectedValueOnce(
      Object.assign(new Error('Missing Access'), { code: 50001 }),
    );
    await expect(
      service().onGroupChanged({
        gameId: GAME_ID,
        reason: 'joined',
        userIds: [3],
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

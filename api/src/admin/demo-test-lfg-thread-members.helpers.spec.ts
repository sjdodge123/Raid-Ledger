/**
 * ROK-1541 — the thread-members read the LFG board smoke polls.
 */
import { findOpenLfmMessage } from '../discord-bot/lfm/lfm-embed.db-helpers';
import { readBoardThreadMembers } from './demo-test-lfg-thread-members.helpers';

jest.mock('../discord-bot/lfm/lfm-embed.db-helpers', () => ({
  findOpenLfmMessage: jest.fn(),
}));

const fetchMembers = jest.fn();
const permissionsFor = jest.fn();
const thread = {
  isThread: () => true,
  members: { fetch: fetchMembers },
  permissionsFor,
};
const me = { id: 'bot' };
const channelsFetch = jest.fn();
const client = { getGuild: jest.fn() };

function read() {
  return readBoardThreadMembers({} as never, client as never, 42);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(findOpenLfmMessage).mockResolvedValue({
    postKind: 'forum',
    threadId: 't1',
    channelId: 'c1',
  } as never);
  client.getGuild.mockReturnValue({
    id: 'guild-1',
    channels: { fetch: channelsFetch },
    members: { me },
  });
  permissionsFor.mockReturnValue({ has: () => true });
  channelsFetch.mockResolvedValue(thread);
  fetchMembers.mockResolvedValue(
    new Map([
      ['111', {}],
      ['222', {}],
    ]),
  );
});

describe('readBoardThreadMembers', () => {
  it("lists the snowflakes in the open forum post's thread", async () => {
    expect(await read()).toEqual({
      threadId: 't1',
      memberIds: ['111', '222'],
      botCanManageThreads: true,
      guildId: 'guild-1',
      botUserId: 'bot',
    });
    expect(permissionsFor).toHaveBeenCalledWith(me);
    expect(channelsFetch).toHaveBeenCalledWith('t1');
  });

  it('returns no thread when the game has no open FORUM post', async () => {
    jest
      .mocked(findOpenLfmMessage)
      .mockResolvedValue({ postKind: 'text', threadId: null } as never);

    expect(await read()).toEqual({
      threadId: null,
      memberIds: [],
      botCanManageThreads: false,
      guildId: null,
      botUserId: null,
    });
    expect(channelsFetch).not.toHaveBeenCalled();
  });

  it('returns no members while the bot is offline', async () => {
    client.getGuild.mockReturnValue(null);

    expect(await read()).toEqual({
      threadId: 't1',
      memberIds: [],
      botCanManageThreads: false,
      guildId: null,
      botUserId: null,
    });
  });

  it('reports a missing Manage Threads grant on the post', async () => {
    permissionsFor.mockReturnValue({ has: () => false });

    expect((await read()).botCanManageThreads).toBe(false);
  });
});

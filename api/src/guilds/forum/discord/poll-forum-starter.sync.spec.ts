/** ROK-2295 lane B — which post a poll's starter edit goes to. */
import { DiscordAPIError } from 'discord.js';
import type { ForumStarterCard } from '../../../discord-bot/services/event-embed-message.editor';
import * as pollReads from '../subject-discussion/poll-discussion.queries';
import * as planningReads from './event-planning-posts.queries';
import type { ForumStarterEditor } from './forum-starter-edit.port';
import * as linkReads from './hub-forum-discord-links.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollForumStarterSync } from './poll-forum-starter.sync';
import type { PollVoterLines } from './poll-voter-lines.refresh';

jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findLivePollThread: jest.fn(),
}));
jest.mock('./event-planning-posts.queries', () => ({
  findLivePlanningPost: jest.fn(),
}));
jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual('./hub-forum-discord-links.queries'),
  findThreadLink: jest.fn(),
}));

const mocked = {
  thread: jest.mocked(pollReads.findLivePollThread),
  planning: jest.mocked(planningReads.findLivePlanningPost),
  link: jest.mocked(linkReads.findThreadLink),
};
const CARD: ForumStarterCard = { embeds: [], components: [] };

function discordError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.assign(err, { code, message: `discord ${code}` });
  return err;
}

function setup() {
  const editStarter = jest.fn().mockResolvedValue('edited');
  const refreshVoterLines = jest.fn().mockResolvedValue(undefined);
  const sync = new PollForumStarterSync(
    {} as ForumDiscordDb,
    { editStarter } as unknown as ForumStarterEditor,
    { refreshVoterLines } as unknown as PollVoterLines,
  );
  return { sync, editStarter, refreshVoterLines };
}

function hubLink(over: Record<string, unknown> = {}) {
  return {
    discordThreadId: 'hub-post-1',
    discordMessageId: 'starter-1',
    discordDeletedAt: null,
    ...over,
  } as unknown as linkReads.ForumLink;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.thread.mockResolvedValue(null);
  mocked.planning.mockResolvedValue(null);
  mocked.link.mockResolvedValue(null);
});

describe('PollForumStarterSync.syncStarter', () => {
  it('a hub poll edits its hub post starter (link discordThreadId)', async () => {
    const { sync, editStarter } = setup();
    mocked.thread.mockResolvedValue({ id: 5 } as never);
    mocked.link.mockResolvedValue(hubLink());
    await sync.syncStarter(7, CARD);
    expect(mocked.link).toHaveBeenCalledWith(expect.anything(), 5);
    expect(editStarter).toHaveBeenCalledWith('hub-post-1', CARD);
    expect(mocked.planning).not.toHaveBeenCalled();
  });

  it('a non-hub poll edits its registry post starter', async () => {
    const { sync, editStarter } = setup();
    mocked.planning.mockResolvedValue({
      discordThreadId: 'plan-post-9',
      discordDeletedAt: null,
    } as never);
    await sync.syncStarter(7, CARD);
    expect(mocked.planning).toHaveBeenCalledWith(expect.anything(), 'poll', 7);
    expect(editStarter).toHaveBeenCalledWith('plan-post-9', CARD);
  });

  it('no post (or an unsent hub claim) ⇒ no edit', async () => {
    const { sync, editStarter } = setup();
    await sync.syncStarter(7, CARD);
    mocked.thread.mockResolvedValue({ id: 5 } as never);
    mocked.link.mockResolvedValue(
      hubLink({ discordMessageId: linkReads.unsentId('thread', 5) }),
    );
    await sync.syncStarter(7, CARD);
    expect(editStarter).not.toHaveBeenCalled();
  });

  it('a locked post (50083) is swallowed; other errors rethrow', async () => {
    const { sync, editStarter } = setup();
    mocked.planning.mockResolvedValue({
      discordThreadId: 'plan-post-9',
      discordDeletedAt: null,
    } as never);
    editStarter.mockRejectedValueOnce(discordError(50083));
    await expect(sync.syncStarter(7, CARD)).resolves.toBeUndefined();
    editStarter.mockRejectedValueOnce(discordError(50001));
    await expect(sync.syncStarter(7, CARD)).rejects.toThrow('discord 50001');
  });

  it('ROK-2295 lane C: the voted lines refresh in the same post, even when the starter edit throws', async () => {
    const { sync, editStarter, refreshVoterLines } = setup();
    mocked.planning.mockResolvedValue({
      discordThreadId: 'plan-post-9',
      discordDeletedAt: null,
    } as never);
    await sync.syncStarter(7, CARD);
    expect(refreshVoterLines).toHaveBeenCalledWith(7, 'plan-post-9');
    editStarter.mockRejectedValueOnce(discordError(50001));
    await expect(sync.syncStarter(7, CARD)).rejects.toThrow('discord 50001');
    expect(refreshVoterLines).toHaveBeenCalledTimes(2);
  });

  it('Codex P2: a gone post (stale / unbound hub) ⇒ no voted-line refresh', async () => {
    const { sync, editStarter, refreshVoterLines } = setup();
    mocked.thread.mockResolvedValue({ id: 5 } as never);
    mocked.link.mockResolvedValue(hubLink());
    editStarter.mockResolvedValueOnce('gone');
    await sync.syncStarter(7, CARD);
    expect(editStarter).toHaveBeenCalledWith('hub-post-1', CARD);
    expect(refreshVoterLines).not.toHaveBeenCalled();
  });

  it('ROK-2295 lane C: no post ⇒ no voted-line refresh', async () => {
    const { sync, refreshVoterLines } = setup();
    await sync.syncStarter(7, CARD);
    expect(refreshVoterLines).not.toHaveBeenCalled();
  });
});

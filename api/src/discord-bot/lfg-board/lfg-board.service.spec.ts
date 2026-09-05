/**
 * ROK-1471 D9/D10 — the forum SURFACE ADAPTER.
 *
 * `LfgBoardService` is NOT a second event consumer. `LfmEmbedService` owns
 * `LFM_REACHED` / `GROUP_CHANGED` and calls in here by `post_kind`, so the
 * claims worth pinning are the ones a race would break:
 *
 *  - **`postThread` never throws** (E2/E17). Its only caller runs inside
 *    `POST /lfg`'s emitter, and a throw there is a 500 on a successful signup.
 *  - **`editThread` DOES throw** — deliberately. `LfmEmbedService.editRow`
 *    reads `isUnknownMessageError` to decide "the post is gone, repost it"
 *    (E3-forum). Swallowing here would silently kill the heal.
 *  - **content edits are immediate, renames/tags are not** (AC8). The five
 *    edits / one rename ratio is the whole of D10.
 *  - **archive happens exactly once and only at a terminal state** (AC7).
 */
import { Test } from '@nestjs/testing';
import { ChannelType } from 'discord.js';
import type { ThreadChannel } from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { isUnknownMessageError } from '../services/embed-poster.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import { LfgBoardChannelService } from './lfg-board-channel.service';
import { LfgBoardService } from './lfg-board.service';
import {
  LFG_BOARD_EDIT_DEBOUNCE_MS,
  LFG_JOIN_BUTTON_LABEL,
} from './lfg-board.constants';

const CLIENT_URL = 'https://raid.example';
const FORUM_ID = 'forum-1';
const THREAD_ID = 'thread-1';
const TAG_NEEDS = 'tag-needs';
const TAG_SCHEDULED = 'tag-scheduled';

const context: EmbedContext = {
  communityName: 'Deep Rock',
  clientUrl: CLIENT_URL,
  timezone: 'UTC',
};

function view(overrides: Partial<LfmGroupView> = {}): LfmGroupView {
  return {
    state: 'open',
    gameId: 42,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    memberCount: 2,
    memberNames: ['Bosco', 'Karl'],
    viabilityThreshold: 4,
    ...overrides,
  };
}

function row(overrides: Partial<LfmMessageRow> = {}): LfmMessageRow {
  return {
    id: 'row-1',
    gameId: 42,
    guildId: 'guild-1',
    channelId: THREAD_ID,
    messageId: 'starter-1',
    state: 'open',
    lastMemberCount: 2,
    threadId: THREAD_ID,
    postKind: 'forum',
    postedAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    closedAt: null,
    ...overrides,
  };
}

const starter = { id: 'starter-1', edit: jest.fn() };

const thread = {
  id: THREAD_ID,
  name: 'Deep Rock Galactic · 2 looking',
  archived: false,
  appliedTags: [TAG_NEEDS],
  isThread: () => true,
  fetchStarterMessage: jest.fn(),
  delete: jest.fn(),
  setName: jest.fn(),
  setAppliedTags: jest.fn(),
  setArchived: jest.fn(),
  parent: null as unknown,
};

const forum = {
  id: FORUM_ID,
  type: ChannelType.GuildForum,
  availableTags: [],
  threads: { create: jest.fn() },
};

const guild = {
  id: 'guild-1',
  channels: { fetch: jest.fn() },
};

const clientService = { getGuild: jest.fn() };
const channelService = { resolveForum: jest.fn(), tagIdFor: jest.fn() };

let service: LfgBoardService;

/** The thread's mock, typed for the calls the service makes on it. */
function asThread(): ThreadChannel {
  return thread as unknown as ThreadChannel;
}

beforeEach(async () => {
  jest.clearAllMocks();
  thread.name = 'Deep Rock Galactic · 2 looking';
  thread.archived = false;
  thread.appliedTags = [TAG_NEEDS];
  forum.availableTags = [];
  thread.parent = forum;
  starter.edit.mockResolvedValue({ id: 'starter-1' });
  thread.fetchStarterMessage.mockResolvedValue(starter);
  thread.setName.mockResolvedValue(asThread());
  thread.setAppliedTags.mockResolvedValue(asThread());
  thread.setArchived.mockResolvedValue(asThread());
  thread.delete.mockResolvedValue(asThread());
  forum.threads.create.mockResolvedValue(thread);
  guild.channels.fetch.mockImplementation((id: string) =>
    Promise.resolve(id === FORUM_ID ? forum : thread),
  );
  clientService.getGuild.mockReturnValue(guild);
  channelService.resolveForum.mockResolvedValue(forum);
  channelService.tagIdFor.mockImplementation((_f: unknown, tag: string) =>
    tag === 'SCHEDULED' ? TAG_SCHEDULED : TAG_NEEDS,
  );

  const module = await Test.createTestingModule({
    providers: [
      LfgBoardService,
      { provide: DiscordBotClientService, useValue: clientService },
      { provide: LfgBoardChannelService, useValue: channelService },
    ],
  }).compile();
  service = module.get(LfgBoardService);
});

afterEach(() => {
  jest.useRealTimers();
});

/** The payload the last `threads.create` was given. */
function createArgs(): {
  name: string;
  appliedTags: string[];
  message: {
    embeds: { data: { description?: string } }[];
    components: unknown[];
  };
} {
  return forum.threads.create.mock.calls[0][0] as never;
}

describe('LfgBoardService.postThread (AC1, AC5, AC6)', () => {
  it('creates the thread with the head-count name, the state tag and the +1 row', async () => {
    const posted = await service.postThread(FORUM_ID, view(), context);

    expect(posted).toEqual({
      threadId: THREAD_ID,
      starterMessageId: 'starter-1',
    });
    const args = createArgs();
    expect(args.name).toBe('Deep Rock Galactic · 2 looking');
    expect(args.appliedTags).toEqual([TAG_NEEDS]);
    expect(JSON.stringify(args.message.components)).toContain(
      LFG_JOIN_BUTTON_LABEL,
    );
  });

  it("renders with linkStyle 'button', so the description carries no masked link", async () => {
    await service.postThread(FORUM_ID, view(), context);

    expect(createArgs().message.embeds[0].data.description).not.toContain(
      '[Open group',
    );
  });

  it('returns null (and posts nothing) when the id is not a forum channel', async () => {
    guild.channels.fetch.mockResolvedValue({
      id: FORUM_ID,
      type: ChannelType.GuildText,
    });

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
    expect(forum.threads.create).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when Discord refuses the post (E2)', async () => {
    forum.threads.create.mockRejectedValue(new Error('Missing Permissions'));

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
  });

  it('deletes the thread it just created when the follow-up fails — no orphan (D2)', async () => {
    thread.fetchStarterMessage.mockRejectedValue(new Error('Missing Access'));

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
    expect(thread.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the thread when the starter message cannot be read back', async () => {
    thread.fetchStarterMessage.mockResolvedValue(null);

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
    expect(thread.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when the create itself failed', async () => {
    forum.threads.create.mockRejectedValue(new Error('Missing Permissions'));

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
    expect(thread.delete).not.toHaveBeenCalled();
  });

  it('returns null when the bot is in no guild (E17)', async () => {
    clientService.getGuild.mockReturnValue(null);

    expect(await service.postThread(FORUM_ID, view(), context)).toBeNull();
    expect(forum.threads.create).not.toHaveBeenCalled();
  });
});

describe('LfgBoardService.editThread — content vs metadata (AC8, D10)', () => {
  it('edits the starter message immediately and does NOT rename in the same tick', async () => {
    jest.useFakeTimers();

    await service.editThread(row(), view({ memberCount: 3 }), context);

    expect(starter.edit).toHaveBeenCalledTimes(1);
    expect(thread.setName).not.toHaveBeenCalled();
  });

  it('coalesces five edits inside the window into ONE setName carrying the last count', async () => {
    jest.useFakeTimers();

    for (const n of [3, 4, 5, 6, 7]) {
      await service.editThread(row(), view({ memberCount: n }), context);
    }
    await service.flushAll();

    expect(starter.edit).toHaveBeenCalledTimes(5);
    expect(thread.setName).toHaveBeenCalledTimes(1);
    expect(thread.setName).toHaveBeenCalledWith(
      'Deep Rock Galactic · 7 looking',
    );
  });

  it('applies the rename on its own when the trailing window closes', async () => {
    jest.useFakeTimers();

    await service.editThread(row(), view({ memberCount: 3 }), context);
    // `advanceTimersByTimeAsync` drains the microtasks the apply chain queues
    // (channel fetch -> setName); the sync form fires the timer and returns
    // before any of them run.
    await jest.advanceTimersByTimeAsync(LFG_BOARD_EDIT_DEBOUNCE_MS);

    expect(thread.setName).toHaveBeenCalledWith(
      'Deep Rock Galactic · 3 looking',
    );
  });

  it('issues zero metadata calls when the persisted name and tag already match (D10)', async () => {
    await service.editThread(row(), view(), context);
    await service.flushAll();

    expect(starter.edit).toHaveBeenCalledTimes(1);
    expect(thread.setName).not.toHaveBeenCalled();
    expect(thread.setAppliedTags).not.toHaveBeenCalled();
  });

  it('never rejects when Discord refuses the rename — the content edit still stands', async () => {
    thread.setName.mockRejectedValue(new Error('Rate limited'));

    await service.editThread(row(), view({ memberCount: 9 }), context);
    await expect(service.flushAll()).resolves.toBeUndefined();
  });
});

describe('LfgBoardService.editThread — terminal states (AC7)', () => {
  it('drops the row, applies the terminal tag and archives exactly once', async () => {
    await service.editThread(
      row(),
      view({ state: 'scheduled', memberCount: 4 }),
      context,
    );

    const payload = starter.edit.mock.calls[0][0] as { components: unknown[] };
    expect(payload.components).toEqual([]);
    expect(thread.setAppliedTags).toHaveBeenCalledWith([TAG_SCHEDULED]);
    expect(thread.setArchived).toHaveBeenCalledTimes(1);
    expect(thread.setArchived).toHaveBeenCalledWith(true);
    expect(forum.threads.create).not.toHaveBeenCalled();
  });

  it('flushes the rename BEFORE archiving, so the final name is not stranded', async () => {
    jest.useFakeTimers();
    const order: string[] = [];
    thread.setName.mockImplementation(() => {
      order.push('setName');
      return Promise.resolve(asThread());
    });
    thread.setArchived.mockImplementation(() => {
      order.push('setArchived');
      return Promise.resolve(asThread());
    });

    await service.editThread(
      row(),
      view({ state: 'closed', memberCount: 1 }),
      context,
    );

    expect(order).toEqual(['setName', 'setArchived']);
  });

  it('still returns when the archive is refused — the row must close anyway', async () => {
    thread.setArchived.mockRejectedValue(new Error('Missing Permissions'));

    await expect(
      service.editThread(row(), view({ state: 'expired' }), context),
    ).resolves.toBeUndefined();
  });

  it('clears a stale board tag when no tag resolves for the terminal state', async () => {
    // E16: the tag top-up was skipped at Discord's 20-tag cap, so `tagIdFor`
    // resolves nothing — the thread must not stay filed under NEEDS PLAYERS.
    forum.availableTags = [
      { id: TAG_NEEDS, name: 'NEEDS PLAYERS' },
    ] as unknown as never[];
    channelService.tagIdFor.mockReturnValue(undefined);
    thread.appliedTags = [TAG_NEEDS];

    await service.editThread(row(), view({ state: 'expired' }), context);

    expect(thread.setAppliedTags).toHaveBeenCalledTimes(1);
    expect(thread.setAppliedTags).toHaveBeenCalledWith([]);
  });

  it('leaves a thread that carries no board tag alone', async () => {
    forum.availableTags = [
      { id: TAG_NEEDS, name: 'NEEDS PLAYERS' },
    ] as unknown as never[];
    channelService.tagIdFor.mockReturnValue(undefined);
    thread.appliedTags = ['someone-elses-tag'];

    await service.editThread(row(), view({ state: 'expired' }), context);

    expect(thread.setAppliedTags).not.toHaveBeenCalled();
  });

  it('un-archives once before editing an archived thread (E7)', async () => {
    thread.archived = true;

    await service.editThread(row(), view({ memberCount: 3 }), context);

    expect(thread.setArchived).toHaveBeenCalledTimes(1);
    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(starter.edit).toHaveBeenCalledTimes(1);
  });
});

describe('LfgBoardService.editThread — errors reach the heal path (E3-forum)', () => {
  it('propagates a deleted starter message so LfmEmbedService can repost', async () => {
    const err = new Error('Unknown Message');
    starter.edit.mockRejectedValue(err);

    await expect(service.editThread(row(), view(), context)).rejects.toThrow(
      err,
    );
  });

  it('reports a deleted THREAD in the vocabulary isUnknownMessageError understands', async () => {
    guild.channels.fetch.mockResolvedValue(null);

    const caught = await service
      .editThread(row(), view(), context)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(isUnknownMessageError(caught)).toBe(true);
  });
});

describe('LfgBoardService.flushAll (D10 / demo flush endpoint)', () => {
  it('drains every pending thread', async () => {
    jest.useFakeTimers();
    await service.editThread(row(), view({ memberCount: 5 }), context);

    await service.flushAll();

    expect(thread.setName).toHaveBeenCalledWith(
      'Deep Rock Galactic · 5 looking',
    );
  });

  it('is what the FLUSH event handler runs', async () => {
    jest.useFakeTimers();
    await service.editThread(row(), view({ memberCount: 6 }), context);

    await service.onFlushRequested();

    expect(thread.setName).toHaveBeenCalledWith(
      'Deep Rock Galactic · 6 looking',
    );
  });
});

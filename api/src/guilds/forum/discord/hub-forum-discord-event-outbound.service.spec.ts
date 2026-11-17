/**
 * ROK-2208 §5.7 items 1, 2, 5 — `EventPostOutbound` with its reads mocked:
 * a lazy post is created (dated title, absolute root link) only for a
 * writable event thread, never for a read-only one or a plain thread; a
 * retitle renames sent posts through the rename budget only.
 */
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type { ForumLink } from './hub-forum-discord-links.queries';
import * as links from './hub-forum-discord-links.queries';
import * as reads from './hub-forum-discord-event-outbound.queries';
import {
  EventPostOutbound,
  type EventPostDeps,
} from './hub-forum-discord-event-outbound.service';

jest.mock('./hub-forum-discord-event-outbound.queries');
jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual<object>('./hub-forum-discord-links.queries'),
  claimThreadLink: jest.fn(),
  findThreadLink: jest.fn(),
  markSent: jest.fn(),
  rehomeReplies: jest.fn(),
}));

const NOW = new Date('2025-11-20T12:00:00Z');
const START = new Date('2025-11-22T19:00:00Z');
const TO = {
  target: { channelId: 'forum-1', webhookId: 'hook-1' },
  tagId: 'tag-1',
};
const REF = { guildId: 7, threadId: 3 };

function linkRow(over: Partial<ForumLink> = {}): ForumLink {
  return {
    id: 11,
    guildId: 7,
    kind: 'thread',
    threadId: 3,
    replyId: null,
    discordThreadId: 'rl:t:3',
    discordMessageId: 'rl:t:3',
    origin: 'raidledger',
    syncState: 'pending',
    attempts: 0,
    lastError: null,
    syncedAt: null,
    discordDeletedAt: null,
    discordLockedAt: null,
    createdAt: NOW,
    ...over,
  };
}

function source(
  over: Partial<reads.EventPostSource> = {},
): reads.EventPostSource {
  return {
    eventId: 9,
    eventTitle: 'Molten Core',
    start: START,
    body: 'Discussion for **Molten Core**. [Open the event](/events/9)',
    writeClosesAt: new Date('2025-11-23T22:00:00Z'),
    eventDetachedAt: null,
    ...over,
  };
}

function setup() {
  const gateway = {
    createPost: jest
      .fn()
      .mockResolvedValue({ threadId: 'p1', messageId: 'p1' }),
    renameThread: jest.fn().mockResolvedValue('ok'),
  };
  const renames = { trySpend: jest.fn().mockReturnValue(true) };
  const attempt = jest.fn(async (_l: ForumLink, run: () => Promise<void>) =>
    run(),
  );
  const deps: EventPostDeps = {
    db: {} as ForumDiscordDb,
    gateway,
    renames,
    now: () => NOW,
    attempt,
    clientUrl: () => Promise.resolve('https://rl.example'),
    timeZone: () => Promise.resolve('UTC'),
  };
  return { svc: new EventPostOutbound(deps), gateway, renames, attempt };
}

const mocked = {
  source: jest.mocked(reads.findEventPostSource),
  heading: jest.mocked(reads.findEventHeading),
  posts: jest.mocked(reads.liveEventPostLinks),
  claim: jest.mocked(links.claimThreadLink),
  find: jest.mocked(links.findThreadLink),
  markSent: jest.mocked(links.markSent),
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.claim.mockResolvedValue(linkRow());
  mocked.find.mockResolvedValue(linkRow({ discordThreadId: 'p1' }));
});

describe('EventPostOutbound.ensurePost (item 1, lazy post)', () => {
  it('creates the dated post with the absolute root link, then returns the link', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValue(source());
    const link = await svc.ensurePost(TO, REF);
    expect(gateway.createPost).toHaveBeenCalledWith(
      TO.target,
      {
        title: 'Molten Core — Sat 22 Nov',
        content:
          'Discussion for **Molten Core**. [Open the event](https://rl.example/events/9)',
        tagIds: ['tag-1'],
      },
      { username: 'Raid Ledger', avatarURL: null },
    );
    expect(mocked.markSent).toHaveBeenCalledWith(
      {},
      11,
      { threadId: 'p1', messageId: 'p1' },
      NOW,
    );
    expect(link?.discordThreadId).toBe('p1');
  });

  it('a plain (non-event) unlinked thread gets no post (OQ-5)', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValue(null);
    expect(await svc.ensurePost(TO, REF)).toBeNull();
    expect(gateway.createPost).not.toHaveBeenCalled();
    expect(mocked.claim).not.toHaveBeenCalled();
  });

  it('item 5: a read-only event thread never posts (closed or detached)', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValueOnce(source({ writeClosesAt: NOW }));
    mocked.source.mockResolvedValueOnce(source({ eventDetachedAt: NOW }));
    expect(await svc.ensurePost(TO, REF)).toBeNull();
    expect(await svc.ensurePost(TO, REF)).toBeNull();
    expect(gateway.createPost).not.toHaveBeenCalled();
    expect(mocked.claim).not.toHaveBeenCalled();
  });

  it('a lost claim race reuses the winner’s post instead of posting twice', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValue(source());
    mocked.claim.mockResolvedValue(null);
    const link = await svc.ensurePost(TO, REF);
    expect(gateway.createPost).not.toHaveBeenCalled();
    expect(link?.discordThreadId).toBe('p1');
  });
});

describe('EventPostOutbound.retitle (item 2)', () => {
  it('renames each sent post to the dated title through the rename budget', async () => {
    const { svc, gateway, renames } = setup();
    mocked.heading.mockResolvedValue({ title: 'Onyxia', start: START });
    mocked.posts.mockResolvedValue([
      linkRow({ discordThreadId: 'p1', discordMessageId: 'p1' }),
      linkRow({ id: 12 }),
    ]);
    await svc.retitle(9);
    expect(gateway.renameThread).toHaveBeenCalledTimes(1);
    const [id, name, spend] = gateway.renameThread.mock.calls[0] ?? [];
    expect([id, name]).toEqual(['p1', 'Onyxia — Sat 22 Nov']);
    expect(typeof spend === 'function' && spend()).toBe(true);
    expect(renames.trySpend).toHaveBeenCalledWith('p1');
  });

  it('does nothing once the event is gone', async () => {
    const { svc, gateway } = setup();
    mocked.heading.mockResolvedValue(null);
    await svc.retitle(9);
    expect(mocked.posts).not.toHaveBeenCalled();
    expect(gateway.renameThread).not.toHaveBeenCalled();
  });
});

describe('EventPostOutbound.postView', () => {
  it('a plain thread keeps its own title', async () => {
    const { svc } = setup();
    const view = await svc.postView(
      { eventId: null, title: 'Raid night', body: 'Bring flasks' },
      'https://rl.example/hubs/7?thread=3#forum',
    );
    expect(view).toEqual({ name: 'Raid night', content: 'Bring flasks' });
  });

  it('an event thread uses the dated title', async () => {
    const { svc } = setup();
    mocked.heading.mockResolvedValue({ title: 'Onyxia', start: START });
    const view = await svc.postView(
      { eventId: 9, title: 'Onyxia', body: 'x' },
      'https://rl.example/hubs/7?thread=3#forum',
    );
    expect(view.name).toBe('Onyxia — Sat 22 Nov');
  });
});

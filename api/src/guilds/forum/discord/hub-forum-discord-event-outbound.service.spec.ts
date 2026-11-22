/**
 * ROK-2208 §5.7 items 1, 2, 5 — `EventPostOutbound` with its reads mocked:
 * a lazy post is created (dated title, absolute root link) only for a
 * writable event thread, never for a read-only one or a plain thread; a
 * retitle never renames directly — it re-drives each live post through the
 * owner's binding-checked `thread.updated` path (review MAJOR-1).
 */
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type { ForumLink } from './hub-forum-discord-links.queries';
import * as links from './hub-forum-discord-links.queries';
import * as reads from './hub-forum-discord-event-outbound.queries';
import * as subjectReads from './hub-forum-discord-subject-post.queries';
import {
  EventPostOutbound,
  type EventPostDeps,
} from './hub-forum-discord-event-outbound.service';

jest.mock('./hub-forum-discord-event-outbound.queries');
jest.mock('./hub-forum-discord-subject-post.queries');
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
/** A plain thread row (no subject) for `postView`. */
const PLAIN = { id: 3, eventId: null, matchId: null, lineupId: null };

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
): subjectReads.SubjectPostSource {
  return {
    kind: 'event',
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
  };
  const redrive = jest
    .fn<Promise<unknown>, [ForumLink]>()
    .mockResolvedValue('dispatched');
  const attempt = jest.fn(async (_l: ForumLink, run: () => Promise<void>) =>
    run(),
  );
  const starters = {
    build: jest.fn().mockResolvedValue(null),
    track: jest.fn().mockResolvedValue(undefined),
  };
  const crosslink = { linkPollPost: jest.fn().mockResolvedValue(undefined) };
  const deps: EventPostDeps = {
    db: {} as ForumDiscordDb,
    gateway,
    now: () => NOW,
    attempt,
    redrive,
    clientUrl: () => Promise.resolve('https://rl.example'),
    timeZone: () => Promise.resolve('UTC'),
    starters,
    crosslink,
  };
  return {
    svc: new EventPostOutbound(deps),
    crosslink,
    gateway,
    redrive,
    attempt,
    starters,
  };
}

const mocked = {
  source: jest.mocked(subjectReads.findSubjectPostSource),
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
        kind: 'event',
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

function scheduleSource(
  over: Partial<subjectReads.ScheduleSubjectPostSource> = {},
): subjectReads.ScheduleSubjectPostSource {
  return {
    kind: 'poll',
    id: 21,
    title: 'Friday raid',
    body: 'Scheduling poll for **WoW**. [Open the poll](/community-lineup/4/schedule/21)',
    writeClosesAt: null,
    eventDetachedAt: null,
    ...over,
  };
}

describe('ROK-2272 S8 ensurePost for poll / lineup threads', () => {
  it('posts a poll thread titled "<title> — Poll" with the Poll kind', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValue(scheduleSource());
    const link = await svc.ensurePost(TO, REF);
    expect(gateway.createPost).toHaveBeenCalledWith(
      TO.target,
      {
        title: 'Friday raid — Poll',
        content:
          'Scheduling poll for **WoW**. [Open the poll](https://rl.example/community-lineup/4/schedule/21)',
        tagIds: ['tag-1'],
        kind: 'poll',
      },
      { username: 'Raid Ledger', avatarURL: null },
    );
    expect(link?.discordThreadId).toBe('p1');
  });

  it('ROK-2295: a sent poll post runs the reschedule cross-link once', async () => {
    const { svc, crosslink } = setup();
    mocked.source.mockResolvedValue(scheduleSource());
    await svc.ensurePost(TO, REF);
    expect(crosslink.linkPollPost.mock.calls).toEqual([[21, 'p1']]);
  });

  it('ROK-2295: lineup and event posts never run the cross-link', async () => {
    const { svc, crosslink } = setup();
    mocked.source.mockResolvedValueOnce(
      scheduleSource({ kind: 'lineup', id: 4, title: 'Game night' }),
    );
    mocked.source.mockResolvedValueOnce(source());
    await svc.ensurePost(TO, REF);
    await svc.ensurePost(TO, REF);
    expect(crosslink.linkPollPost).not.toHaveBeenCalled();
  });

  it('posts a lineup thread titled "<title> — Lineup" with the Lineup kind', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValue(
      scheduleSource({ kind: 'lineup', id: 4, title: 'Game night' }),
    );
    await svc.ensurePost(TO, REF);
    expect(gateway.createPost).toHaveBeenCalledWith(
      TO.target,
      expect.objectContaining({ title: 'Game night — Lineup', kind: 'lineup' }),
      expect.anything(),
    );
  });

  it('a read-only poll thread never posts (closed or detached)', async () => {
    const { svc, gateway } = setup();
    mocked.source.mockResolvedValueOnce(scheduleSource({ writeClosesAt: NOW }));
    mocked.source.mockResolvedValueOnce(
      scheduleSource({ eventDetachedAt: NOW }),
    );
    expect(await svc.ensurePost(TO, REF)).toBeNull();
    expect(await svc.ensurePost(TO, REF)).toBeNull();
    expect(gateway.createPost).not.toHaveBeenCalled();
    expect(mocked.claim).not.toHaveBeenCalled();
  });

  it('isSubjectThread: event, poll and lineup threads yes, plain no', () => {
    const { svc } = setup();
    const none = { eventId: null, matchId: null, lineupId: null };
    expect(svc.isSubjectThread(none)).toBe(false);
    expect(svc.isSubjectThread({ ...none, eventId: 1 })).toBe(true);
    expect(svc.isSubjectThread({ ...none, matchId: 2 })).toBe(true);
    expect(svc.isSubjectThread({ ...none, lineupId: 3 })).toBe(true);
  });
});

describe('EventPostOutbound.retitle (item 2)', () => {
  it('re-drives every live post through the owner and never renames directly', async () => {
    const { svc, redrive } = setup();
    const sent = linkRow({ discordThreadId: 'p1', discordMessageId: 'p1' });
    const other = linkRow({ id: 12, threadId: 4 });
    mocked.posts.mockResolvedValue([sent, other]);
    await svc.retitle(9);
    expect(mocked.posts).toHaveBeenCalledWith({}, 9);
    expect(redrive.mock.calls).toEqual([[sent], [other]]);
  });

  it('does nothing when the event has no live post', async () => {
    const { svc, redrive } = setup();
    mocked.posts.mockResolvedValue([]);
    await svc.retitle(9);
    expect(redrive).not.toHaveBeenCalled();
  });
});

describe('EventPostOutbound.postView', () => {
  it('a plain thread keeps its own title', async () => {
    const { svc } = setup();
    const view = await svc.postView(
      { ...PLAIN, title: 'Raid night', body: 'Bring flasks' },
      'https://rl.example/hubs/7?thread=3#forum',
    );
    expect(view).toEqual({ name: 'Raid night', content: 'Bring flasks' });
    expect(mocked.source).not.toHaveBeenCalled();
  });

  it('an event thread uses the dated title', async () => {
    const { svc } = setup();
    mocked.heading.mockResolvedValue({ title: 'Onyxia', start: START });
    const view = await svc.postView(
      { ...PLAIN, eventId: 9, title: 'Onyxia', body: 'x' },
      'https://rl.example/hubs/7?thread=3#forum',
    );
    expect(view.name).toBe('Onyxia — Sat 22 Nov');
    expect(mocked.source).not.toHaveBeenCalled();
  });
});

/** S8 review MAJOR-1: a poll / lineup re-drive renders as `send` posted it. */
describe('EventPostOutbound.postView — poll and lineup threads', () => {
  const URL3 = 'https://rl.example/hubs/7?thread=3#forum';
  const pollBody =
    'Scheduling poll for **Onyxia**. [Open the poll](/community-lineup/12/schedule/34)';

  function schedule(
    kind: 'poll' | 'lineup',
    title: string,
    body: string,
  ): subjectReads.SubjectPostSource {
    const id = kind === 'poll' ? 34 : 12;
    return {
      kind,
      id,
      title,
      body,
      writeClosesAt: null,
      eventDetachedAt: null,
    };
  }

  it('a poll thread keeps " — Poll" and an absolute link, not the S7 thread title', async () => {
    const { svc } = setup();
    mocked.source.mockResolvedValue(schedule('poll', 'Onyxia', pollBody));
    const view = await svc.postView(
      { ...PLAIN, matchId: 34, title: 'Scheduling: Onyxia', body: pollBody },
      URL3,
    );
    expect(mocked.source).toHaveBeenCalledWith({}, 3);
    expect(view).toEqual({
      name: 'Onyxia — Poll',
      content:
        'Scheduling poll for **Onyxia**. [Open the poll](https://rl.example/community-lineup/12/schedule/34)',
    });
  });

  it('a long poll title is cut at a word boundary and keeps the suffix', async () => {
    const { svc } = setup();
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    mocked.source.mockResolvedValue(schedule('poll', long, pollBody));
    const view = await svc.postView(
      { ...PLAIN, matchId: 34, title: long, body: pollBody },
      URL3,
    );
    expect(view.name.length).toBeLessThanOrEqual(100);
    expect(view.name).toMatch(/^word0 .*word\d+ — Poll$/);
  });

  it('a lineup thread is named "<title> — Lineup" with an absolute link', async () => {
    const { svc } = setup();
    const body = 'Lineup **Week 47**. [Open the lineup](/community-lineup/12)';
    mocked.source.mockResolvedValue(schedule('lineup', 'Week 47', body));
    const view = await svc.postView(
      { ...PLAIN, lineupId: 12, title: 'Week 47', body },
      URL3,
    );
    expect(view).toEqual({
      name: 'Week 47 — Lineup',
      content:
        'Lineup **Week 47**. [Open the lineup](https://rl.example/community-lineup/12)',
    });
  });
});

describe('ROK-2292 delta-3: starter tracking after a sent post', () => {
  it('a tracking failure is logged, never fails the sent post (no retry, no second post)', async () => {
    const { svc, gateway, attempt, starters } = setup();
    mocked.source.mockResolvedValue(source());
    const card = { embeds: [], components: [], state: 'posted' };
    starters.build.mockResolvedValue(card);
    starters.track.mockRejectedValue(new Error('re-read failed'));
    const link = await svc.ensurePost(TO, REF);
    expect(gateway.createPost).toHaveBeenCalledTimes(1);
    expect(mocked.markSent).toHaveBeenCalledTimes(1);
    expect(starters.track).toHaveBeenCalledWith(9, 'p1', 'posted');
    const run = attempt.mock.results[0]?.value as Promise<void>;
    await expect(run).resolves.toBeUndefined();
    expect(link?.discordThreadId).toBe('p1');
  });
});

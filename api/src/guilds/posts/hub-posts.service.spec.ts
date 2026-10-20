/**
 * ROK-1868 L3a — HubPostsService: access, body pipeline, the A4 remembered
 * default, the create-only LEADER_POST emit and the relay outcome mapping.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import type { GuildAccessService } from '../guild-access.service';
import { HUB_NOTIFICATION_EVENTS } from '../../notifications/hub-notification.constants';
import { findProfileRow, upsertProfile } from '../guild-profile.queries';
import {
  deletePost,
  findPost,
  insertPost,
  listPosts,
  updatePostBody,
  type HubPostRecord,
} from './hub-posts.queries';
import { HubPostsService } from './hub-posts.service';

jest.mock('../guild-core.queries', () => ({
  findGuild: jest.fn().mockResolvedValue({ id: 7, name: 'Keepers' }),
}));
jest.mock('../guild-profile.queries', () => ({
  findProfileRow: jest.fn(),
  upsertProfile: jest.fn(),
}));
jest.mock('./hub-posts.queries', () => ({
  listPosts: jest.fn(),
  findPost: jest.fn(),
  insertPost: jest.fn(),
  updatePostBody: jest.fn(),
  deletePost: jest.fn(),
  latestPost: jest.fn(),
}));

const actor = { id: 3, role: 'member' } as const;
const T = new Date('2026-10-20T10:00:00.000Z');

function row(over: Partial<HubPostSelect> = {}): HubPostSelect {
  return {
    id: 11,
    guildId: 7,
    body: 'Hello',
    authorId: 3,
    createdAt: T,
    updatedAt: T,
    updatedBy: null,
    relayChannelId: null,
    relayMessageId: null,
    relayedAt: null,
    ...over,
  };
}

function record(over: Partial<HubPostSelect> = {}): HubPostRecord {
  return { post: row(over), author: null, editor: null };
}

interface Harness {
  service: HubPostsService;
  emit: jest.Mock;
  relay: { availability: jest.Mock; relay: jest.Mock; unrelay: jest.Mock };
  canView: jest.Mock;
}

function build(channel: object = { state: 'unset' }): Harness {
  const emit = jest.fn();
  const canView = jest.fn().mockResolvedValue(true);
  const relay = {
    availability: jest.fn().mockResolvedValue(channel),
    relay: jest.fn().mockResolvedValue('sent'),
    unrelay: jest.fn().mockResolvedValue(undefined),
    discordGuildId: jest.fn().mockReturnValue(null),
  };
  const service = new HubPostsService(
    {} as PostgresJsDatabase<typeof schema>,
    { canView } as unknown as GuildAccessService,
    relay,
    { emit } as unknown as EventEmitter2,
  );
  return { service, emit, relay, canView };
}

const OK = { state: 'ok', channelId: 'c1', channelName: 'news' };

beforeEach(() => {
  jest.mocked(insertPost).mockResolvedValue(row());
  jest.mocked(findPost).mockResolvedValue(record());
  jest.mocked(findProfileRow).mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('HubPostsService.create', () => {
  it('normalises the body, emits LEADER_POST once, and answers not_requested', async () => {
    const { service, emit, relay } = build();
    const out = await service.create(actor, 7, {
      body: 'a\r\n\r\n\r\n\r\nb',
      relayToDiscord: false,
    });
    expect(insertPost).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ guildId: 7, body: 'a\n\nb', authorId: 3 }),
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(HUB_NOTIFICATION_EVENTS.LEADER_POST, {
      guildId: 7,
      actorId: 3,
      postId: 11,
      body: 'Hello',
    });
    expect(relay.relay).not.toHaveBeenCalled();
    expect(out.relayOutcome).toBe('not_requested');
    expect(out.post.id).toBe(11);
  });

  it('answers unavailable and leaves the default alone when no channel is usable', async () => {
    const { service, relay } = build({ state: 'unset' });
    const out = await service.create(actor, 7, {
      body: 'Hi',
      relayToDiscord: true,
    });
    expect(out.relayOutcome).toBe('unavailable');
    expect(relay.relay).not.toHaveBeenCalled();
    expect(upsertProfile).not.toHaveBeenCalled();
  });
});

describe('HubPostsService.create — relay', () => {
  it.each([true, false])(
    'A4: remembers relayToDiscord=%s when the relay is available',
    async (relayToDiscord) => {
      const { service } = build(OK);
      await service.create(actor, 7, { body: 'Hi', relayToDiscord });
      expect(upsertProfile).toHaveBeenCalledWith(
        {},
        7,
        expect.objectContaining({ postRelayDefault: relayToDiscord }),
      );
    },
  );

  it('relays to the available channel and reports sent', async () => {
    const { service, relay } = build(OK);
    const out = await service.create(actor, 7, {
      body: 'Hi',
      relayToDiscord: true,
    });
    expect(relay.relay).toHaveBeenCalledWith(record(), {
      guildId: 7,
      guildName: 'Keepers',
      channelId: 'c1',
    });
    expect(out.relayOutcome).toBe('sent');
  });

  it('reports failed when the relay rejects — the post still stands', async () => {
    const { service, relay } = build(OK);
    relay.relay.mockRejectedValue(new Error('boom'));
    const out = await service.create(actor, 7, {
      body: 'Hi',
      relayToDiscord: true,
    });
    expect(out.relayOutcome).toBe('failed');
    expect(out.post.id).toBe(11);
  });
});

describe('HubPostsService.create — body pipeline', () => {
  it('400s an HTML body with the markdown message under `body`', async () => {
    const { service, emit } = build();
    const err = await service
      .create(actor, 7, { body: '<b>x</b>', relayToDiscord: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const res = (err as BadRequestException).getResponse() as {
      body?: string[];
    };
    expect(res.body?.[0]).toMatch(/HTML/);
    expect(insertPost).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('400s a body that normalises to nothing (zero-width only)', async () => {
    const { service } = build();
    await expect(
      service.create(actor, 7, { body: '​​', relayToDiscord: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insertPost).not.toHaveBeenCalled();
  });
});

describe('HubPostsService.update', () => {
  it('returns the row untouched when the normalised body is unchanged', async () => {
    const { service, emit } = build();
    const out = await service.update(actor, 7, 11, { body: 'Hello\r' });
    expect(updatePostBody).not.toHaveBeenCalled();
    expect(out.body).toBe('Hello');
    expect(emit).not.toHaveBeenCalled();
  });

  it('writes a changed body with the editor stamp — no emit, no relay', async () => {
    const { service, emit, relay } = build(OK);
    jest.mocked(updatePostBody).mockResolvedValue(row({ body: 'New' }));
    await service.update(actor, 7, 11, { body: 'New' });
    expect(updatePostBody).toHaveBeenCalledWith(
      {},
      { guildId: 7, postId: 11 },
      expect.objectContaining({ body: 'New', editorId: 3 }),
    );
    expect(emit).not.toHaveBeenCalled();
    expect(relay.relay).not.toHaveBeenCalled();
  });

  it('404s a post that is missing or in another guild', async () => {
    const { service } = build();
    jest.mocked(findPost).mockResolvedValue(undefined);
    await expect(
      service.update(actor, 7, 99, { body: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HubPostsService.remove', () => {
  it('unrelays a relayed post and never emits', async () => {
    const { service, emit, relay } = build();
    jest
      .mocked(deletePost)
      .mockResolvedValue({ relayChannelId: 'c1', relayMessageId: 'm1' });
    await service.remove(7, 11);
    expect(relay.unrelay).toHaveBeenCalledWith('c1', 'm1');
    expect(emit).not.toHaveBeenCalled();
  });

  it('skips unrelay for a never-relayed post and 404s a missing one', async () => {
    const { service, relay } = build();
    jest
      .mocked(deletePost)
      .mockResolvedValueOnce({ relayChannelId: null, relayMessageId: null })
      .mockResolvedValueOnce(undefined);
    await service.remove(7, 11);
    expect(relay.unrelay).not.toHaveBeenCalled();
    await expect(service.remove(7, 12)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('HubPostsService reads', () => {
  it('list: 403s a non-viewer before touching the feed', async () => {
    const { service, canView } = build();
    canView.mockResolvedValue(false);
    await expect(service.list(actor, 7, {})).rejects.toThrow(/member/i);
    expect(listPosts).not.toHaveBeenCalled();
  });

  it('list: defaults the page to 10 and encodes the next cursor', async () => {
    const { service } = build();
    jest.mocked(listPosts).mockResolvedValue({
      records: [record()],
      next: { createdAt: T, id: 11 },
    });
    const out = await service.list(actor, 7, {});
    expect(listPosts).toHaveBeenCalledWith({}, 7, 10, null);
    expect(out.posts).toHaveLength(1);
    expect(typeof out.nextCursor).toBe('string');
  });

  it('list: 400s a bad cursor', async () => {
    const { service } = build();
    await expect(
      service.list(actor, 7, { cursor: '!!not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('composer: relayDefault from the profile row (false when none) + channel', async () => {
    const { service } = build(OK);
    expect(await service.composer(7)).toEqual({
      relayDefault: false,
      channel: OK,
    });
    jest
      .mocked(findProfileRow)
      .mockResolvedValue({ postRelayDefault: true } as never);
    expect((await service.composer(7)).relayDefault).toBe(true);
  });
});

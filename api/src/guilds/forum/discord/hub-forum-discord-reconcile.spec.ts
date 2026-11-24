/**
 * ROK-2208 Codex P1: the 5-minute outbound retry sweep must not run while the
 * bot is offline — each write would throw and burn one of the 5 attempts,
 * stranding the queued row past the cap even after the bot reconnects.
 */
import * as Sentry from '@sentry/nestjs';
import * as links from './hub-forum-discord-links.queries';
import * as titles from './hub-forum-discord-poll-titles';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import type { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function service(online: boolean, outbound: object = {}) {
  const gateway = { isOnline: () => online };
  return new HubForumDiscordReconcileService(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordReconcileGateway,
    {} as HubForumDiscordInboundIngest,
    outbound as HubForumDiscordOutboundService,
  );
}

const sentLink = {
  id: 1,
  origin: 'raidledger',
  discordThreadId: '900',
  discordMessageId: '901',
  discordDeletedAt: null,
  discordLockedAt: null,
} as links.ForumLink;

describe('ROK-2208 outbound retry sweep — bot offline guard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads no queue (so consumes no attempt) while the bot is offline', async () => {
    const queue = jest.spyOn(links, 'retryableLinks').mockResolvedValue([]);
    expect(await service(false).retrySweep()).toBe(0);
    expect(queue).not.toHaveBeenCalled();
  });

  it('reads the queue once the bot is online', async () => {
    const queue = jest.spyOn(links, 'retryableLinks').mockResolvedValue([]);
    expect(await service(true).retrySweep()).toBe(0);
    expect(queue).toHaveBeenCalledTimes(1);
  });
});

describe('ROK-2301 follow-up poll linked: one hub post re-drive', () => {
  afterEach(() => jest.restoreAllMocks());
  const payload = { matchId: 77, endedEventId: 42 };

  it('re-drives the live post once as thread.updated', async () => {
    jest.spyOn(titles, 'findLivePollPostLink').mockResolvedValue(sentLink);
    const retry = jest.fn().mockResolvedValue('dispatched');
    await service(true, { retry }).onFollowupPollLinked(payload);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(sentLink, 'thread.updated');
  });

  it('does nothing offline or with no post yet', async () => {
    const find = jest.spyOn(titles, 'findLivePollPostLink');
    find.mockResolvedValue(null);
    const retry = jest.fn();
    await service(false, { retry }).onFollowupPollLinked(payload);
    expect(find).not.toHaveBeenCalled();
    await service(true, { retry }).onFollowupPollLinked(payload);
    expect(retry).not.toHaveBeenCalled();
  });

  it('a failing re-drive is captured, never thrown', async () => {
    jest.spyOn(titles, 'findLivePollPostLink').mockResolvedValue(sentLink);
    const retry = jest.fn().mockRejectedValue(new Error('discord 500'));
    await expect(
      service(true, { retry }).onFollowupPollLinked(payload),
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('ROK-2314 MAJOR-2: retryLinks re-drives a reopened post', () => {
  afterEach(() => jest.restoreAllMocks());
  const reply = (id: number): links.ForumLink => ({
    ...sentLink,
    id,
    kind: 'reply',
  });

  it('re-drives each link once, in the given order', async () => {
    jest.spyOn(links, 'rlRowDeleted').mockResolvedValue(false);
    const retry = jest.fn().mockResolvedValue('unbound');
    const rows = [reply(5), reply(8), reply(12)];
    expect(await service(true, { retry }).retryLinks(rows)).toBe(3);
    expect(retry).toHaveBeenCalledTimes(3);
    expect(retry).toHaveBeenNthCalledWith(1, rows[0], 'reply.updated');
    expect(retry).toHaveBeenNthCalledWith(2, rows[1], 'reply.updated');
    expect(retry).toHaveBeenNthCalledWith(3, rows[2], 'reply.updated');
  });

  it('does nothing while the bot is offline', async () => {
    const deleted = jest.spyOn(links, 'rlRowDeleted');
    const retry = jest.fn();
    expect(await service(false, { retry }).retryLinks([reply(5)])).toBe(0);
    expect(retry).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });
});

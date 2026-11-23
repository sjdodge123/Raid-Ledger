/**
 * ROK-2301 retroactive rename (unit): the reconnect catch-up syncs each
 * live poll's Raid Ledger thread, re-drives only a renamable hub post, keeps
 * going past one failing poll, and the reconcile service runs it on connect
 * even when the inbound reconcile failed.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import * as pollSync from '../subject-discussion/poll-discussion.sync';
import type { ForumLink } from './hub-forum-discord-links.queries';
import type { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import * as titles from './hub-forum-discord-poll-titles';
import type { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function link(over: Partial<ForumLink> = {}): ForumLink {
  return {
    id: 1,
    origin: 'raidledger',
    discordThreadId: '900',
    discordMessageId: '901',
    discordDeletedAt: null,
    discordLockedAt: null,
    ...over,
  } as ForumLink;
}

function deps(redrive: boolean) {
  return {
    syncThread: jest.fn().mockResolvedValue('refresh'),
    redrive: redrive ? jest.fn().mockResolvedValue('dispatched') : null,
    onError: jest.fn(),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('ROK-2301 catchUpPollTitles', () => {
  it('syncs the Raid Ledger thread, then re-drives a renamable post', async () => {
    const d = deps(true);
    const post = link();
    const n = await titles.catchUpPollTitles([{ matchId: 7, link: post }], d);
    expect(n).toBe(1);
    expect(d.syncThread).toHaveBeenCalledWith(7);
    expect(d.redrive).toHaveBeenCalledWith(post);
  });

  it.each([
    ['no post', null],
    ['a locked post', link({ discordLockedAt: new Date() })],
    ['a deleted post', link({ discordDeletedAt: new Date() })],
    [
      'an unsent post',
      link({ discordThreadId: 'rl:t:5', discordMessageId: 'rl:t:5' }),
    ],
    ['a Discord-origin post', link({ origin: 'discord' })],
  ])('never re-drives %s (the thread is still synced)', async (_, l) => {
    const d = deps(true);
    await titles.catchUpPollTitles([{ matchId: 7, link: l }], d);
    expect(d.syncThread).toHaveBeenCalledWith(7);
    expect(d.redrive).not.toHaveBeenCalled();
  });

  it('offline: Raid Ledger threads only', async () => {
    const d = deps(false);
    const n = await titles.catchUpPollTitles([{ matchId: 7, link: link() }], d);
    expect(n).toBe(1);
    expect(d.syncThread).toHaveBeenCalledWith(7);
  });

  it('one failing poll is reported and the rest still run', async () => {
    const d = deps(true);
    d.syncThread.mockRejectedValueOnce(new Error('db'));
    const rows = [
      { matchId: 7, link: link() },
      { matchId: 8, link: link({ id: 2, discordThreadId: '910' }) },
    ];
    expect(await titles.catchUpPollTitles(rows, d)).toBe(1);
    expect(d.onError).toHaveBeenCalledWith(7, expect.any(Error));
    expect(d.syncThread).toHaveBeenCalledWith(8);
    expect(d.redrive).toHaveBeenCalledTimes(1);
  });

  it('each poll runs once per pass, even if listed twice', async () => {
    const d = deps(true);
    const rows = [
      { matchId: 7, link: link() },
      { matchId: 7, link: link() },
    ];
    expect(await titles.catchUpPollTitles(rows, d)).toBe(1);
    expect(d.redrive).toHaveBeenCalledTimes(1);
  });
});

function reconcile(online: boolean) {
  const outbound = { retry: jest.fn().mockResolvedValue('dispatched') };
  const svc = new HubForumDiscordReconcileService(
    {} as ForumDiscordDb,
    { isOnline: () => online } as unknown as HubForumDiscordReconcileGateway,
    {} as HubForumDiscordInboundIngest,
    outbound as unknown as HubForumDiscordOutboundService,
  );
  jest.spyOn(svc, 'retrySweep').mockResolvedValue(0);
  return { svc, outbound };
}

describe('ROK-2301 reconcile service runs the poll title catch-up on connect', () => {
  it('re-drives the live post as thread.updated after syncing the thread', async () => {
    const { svc, outbound } = reconcile(true);
    jest.spyOn(svc, 'reconcileAll').mockResolvedValue();
    const post = link();
    jest
      .spyOn(titles, 'findLivePollThreads')
      .mockResolvedValue([{ matchId: 7, link: post }]);
    const sync = jest
      .spyOn(pollSync, 'syncPollDiscussion')
      .mockResolvedValue('refresh');
    await svc.onConnected();
    expect(sync).toHaveBeenCalledWith(expect.anything(), 7, expect.any(Date));
    expect(outbound.retry).toHaveBeenCalledWith(post, 'thread.updated');
  });

  it('still runs when the inbound reconcile failed, and never throws', async () => {
    const { svc } = reconcile(true);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(svc, 'reconcileAll').mockRejectedValue(new Error('gw'));
    const find = jest
      .spyOn(titles, 'findLivePollThreads')
      .mockRejectedValue(new Error('db'));
    await expect(svc.onConnected()).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { hub_forum: 'poll-titles' },
    });
  });
});

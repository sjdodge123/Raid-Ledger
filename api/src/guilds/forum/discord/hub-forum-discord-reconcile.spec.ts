/**
 * ROK-2208 Codex P1: the 5-minute outbound retry sweep must not run while the
 * bot is offline — each write would throw and burn one of the 5 attempts,
 * stranding the queued row past the cap even after the bot reconnects.
 */
import * as links from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import type { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

function service(online: boolean) {
  const gateway = { isOnline: () => online };
  return new HubForumDiscordReconcileService(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordReconcileGateway,
    {} as HubForumDiscordInboundIngest,
    {} as HubForumDiscordOutboundService,
  );
}

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

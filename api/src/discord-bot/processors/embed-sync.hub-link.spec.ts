/**
 * ROK-1872: the embed-sync refresh resolves the card's hub link from the
 * event row it already holds (game + `guild_id` tag) — no hub ⇒ no key.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_SYNC_QUEUE } from '../queues/embed-sync.queue';
import { QueueHealthService } from '../../queue/queue-health.service';
import { resolveGameHubLinkSafe } from '../channel-lifecycle/hub-link.resolver';

jest.mock('../channel-lifecycle/hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn(),
}));

const BASE = 'http://localhost:5173';
const safe = jest.mocked(resolveGameHubLinkSafe);

async function makeProcessor(): Promise<EmbedSyncProcessor> {
  const module = await Test.createTestingModule({
    providers: [
      EmbedSyncProcessor,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: getQueueToken(EMBED_SYNC_QUEUE), useValue: {} },
      { provide: QueueHealthService, useValue: { register: jest.fn() } },
      { provide: DiscordBotClientService, useValue: {} },
      { provide: DiscordEmbedFactory, useValue: {} },
      { provide: ScheduledEventService, useValue: {} },
      { provide: ChannelResolverService, useValue: {} },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest.fn().mockResolvedValue({ communityName: 'G' }),
          getClientUrl: jest.fn().mockResolvedValue(BASE),
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
        },
      },
    ],
  }).compile();
  return module.get(EmbedSyncProcessor);
}

describe('EmbedSyncProcessor.buildContext — hub link (ROK-1872)', () => {
  beforeEach(() => safe.mockReset());

  it('resolves with the event game + tagged hub and sets hubLink', async () => {
    const hub = { url: `${BASE}/guilds/7`, label: 'Hub' as const };
    safe.mockResolvedValueOnce(hub);
    const processor = await makeProcessor();
    const ctx = await processor['buildContext']({ gameId: 5, guildId: 7 });
    expect(ctx.hubLink).toEqual(hub);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 5, taggedGuildId: 7, clientUrl: BASE },
      expect.anything(),
    );
  });

  it('omits hubLink when nothing resolves (resolver failed or no hub)', async () => {
    safe.mockResolvedValueOnce(null);
    const processor = await makeProcessor();
    const ctx = await processor['buildContext']({ gameId: 5, guildId: null });
    expect(ctx).toEqual({
      communityName: 'G',
      clientUrl: BASE,
      timezone: 'UTC',
    });
    expect('hubLink' in ctx).toBe(false);
  });
});

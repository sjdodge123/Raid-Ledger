/**
 * ROK-1872 (ROK-1428 §2.8): a shared copy of the event card carries the
 * event's hub link, resolved like the poster; no hub ⇒ no `hubLink` key.
 */
import type { InjectionToken } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ShareService } from './share.service';
import { EventsService } from './events.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordEmbedFactory } from '../discord-bot/services/discord-embed.factory';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { resolveEventHubLink } from '../discord-bot/channel-lifecycle/embed-hub-link.helpers';

jest.mock('../discord-bot/channel-lifecycle/embed-hub-link.helpers', () => ({
  ...jest.requireActual<object>(
    '../discord-bot/channel-lifecycle/embed-hub-link.helpers',
  ),
  resolveEventHubLink: jest.fn(),
}));

const BASE = 'https://raid.example.com';
const HUB = { url: `${BASE}/guilds/7`, label: 'Hub' as const };
const resolve = jest.mocked(resolveEventHubLink);

/** An empty `useValue` provider for a token the test never touches. */
function stub(provide: InjectionToken): {
  provide: InjectionToken;
  useValue: object;
} {
  return { provide, useValue: {} };
}

async function makeService(): Promise<ShareService> {
  const module = await Test.createTestingModule({
    providers: [
      ShareService,
      ...[DrizzleAsyncProvider, DiscordBotClientService].map(stub),
      ...[DiscordEmbedFactory, EventsService].map(stub),
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
  return module.get(ShareService);
}

describe('ShareService — hub link (ROK-1872)', () => {
  beforeEach(() => resolve.mockReset());

  it('shared card context carries the event hub link', async () => {
    resolve.mockResolvedValueOnce(HUB);
    const service = await makeService();
    expect(await service['buildContext'](42)).toEqual({
      communityName: 'G',
      clientUrl: BASE,
      timezone: 'UTC',
      hubLink: HUB,
    });
    expect(resolve).toHaveBeenCalledWith({}, 42, BASE, expect.anything());
  });

  it('no hub ⇒ the pre-ROK-1872 context exactly', async () => {
    resolve.mockResolvedValueOnce(null);
    const service = await makeService();
    expect(await service['buildContext'](42)).toStrictEqual({
      communityName: 'G',
      clientUrl: BASE,
      timezone: 'UTC',
    });
  });
});

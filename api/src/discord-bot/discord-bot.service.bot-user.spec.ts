/**
 * ROK-1469 D4 — the bot status endpoint reports the RUNNING identity.
 *
 * Fleet envs each run their OWN Discord application (one per runner slot), so
 * a smoke test can no longer assume "the only bot in this channel is mine".
 * The companion bot resolves the API's bot user id from
 * `GET /admin/settings/discord-bot` at connect and filters channel reads on
 * it. That makes `botUserId` / `botUsername` load-bearing: when the bot is
 * connected they must be present, and when it is NOT connected they must be
 * absent rather than stale (a stale id would filter out every real message).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

describe('DiscordBotService — running bot identity (ROK-1469)', () => {
  let service: DiscordBotService;
  let clientService: jest.Mocked<Partial<DiscordBotClientService>>;

  beforeEach(async () => {
    clientService = {
      isConnected: jest.fn().mockReturnValue(true),
      isConnecting: jest.fn().mockReturnValue(false),
      getGuildInfo: jest
        .fn()
        .mockReturnValue({ name: 'Guild', memberCount: 3 }),
      getBotUser: jest
        .fn()
        .mockReturnValue({ id: '900000000000000009', username: 'RL Slot 2' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordBotService,
        { provide: DiscordBotClientService, useValue: clientService },
        {
          provide: SettingsService,
          useValue: {
            getDiscordBotConfig: jest
              .fn()
              .mockResolvedValue({ token: 'tok', enabled: true }),
            isDiscordBotSetupCompleted: jest.fn().mockResolvedValue(true),
            getAdHocEventsEnabled: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    service = module.get(DiscordBotService);
  });

  it('reports the connected bot user id and username', async () => {
    const status = await service.getStatus();
    expect(status).toMatchObject({
      connected: true,
      botUserId: '900000000000000009',
      botUsername: 'RL Slot 2',
    });
  });

  it('omits the identity when the bot is not connected', async () => {
    (clientService.isConnected as jest.Mock).mockReturnValue(false);
    const status = await service.getStatus();
    expect(status.botUserId).toBeUndefined();
    expect(status.botUsername).toBeUndefined();
  });

  it('omits the identity when the client cannot resolve a user', async () => {
    (clientService.getBotUser as jest.Mock).mockReturnValue(null);
    const status = await service.getStatus();
    expect(status.connected).toBe(true);
    expect(status.botUserId).toBeUndefined();
  });

  it('never leaks the bot token through the status payload', async () => {
    const status = await service.getStatus();
    expect(JSON.stringify(status)).not.toContain('tok');
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';

describe('ChannelResolverService', () => {
  let service: ChannelResolverService;
  let settingsService: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelResolverService,
        {
          provide: SettingsService,
          useValue: {
            getDiscordBotDefaultChannel: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ChannelResolverService);
    settingsService = module.get(SettingsService);
  });

  it('should return the default channel when configured', async () => {
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
      'channel-123',
    );

    const result = await service.resolveChannelForEvent('game-uuid');

    expect(result).toBe('channel-123');
  });

  it('should return null when no default channel is configured', async () => {
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);

    const result = await service.resolveChannelForEvent('game-uuid');

    expect(result).toBeNull();
  });

  it('should return the default channel even when no game ID is provided', async () => {
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
      'channel-123',
    );

    const result = await service.resolveChannelForEvent(null);

    expect(result).toBe('channel-123');
  });

  it('should return the default channel when game ID is undefined', async () => {
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
      'channel-123',
    );

    const result = await service.resolveChannelForEvent();

    expect(result).toBe('channel-123');
  });
});

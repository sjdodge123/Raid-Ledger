/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ChannelResolverService } from './channel-resolver.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';

describe('ChannelResolverService', () => {
  let service: ChannelResolverService;
  let settingsService: jest.Mocked<SettingsService>;
  let bindingsService: jest.Mocked<ChannelBindingsService>;
  let clientService: jest.Mocked<DiscordBotClientService>;

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
        {
          provide: ChannelBindingsService,
          useValue: {
            getChannelForGame: jest.fn(),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            getGuildId: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ChannelResolverService);
    settingsService = module.get(SettingsService);
    bindingsService = module.get(ChannelBindingsService);
    clientService = module.get(DiscordBotClientService);
  });

  it('should return game-specific binding channel when available', async () => {
    clientService.getGuildId.mockReturnValue('guild-123');
    bindingsService.getChannelForGame.mockResolvedValue('game-channel-456');

    const result = await service.resolveChannelForEvent(101);

    expect(result).toBe('game-channel-456');
    expect(bindingsService.getChannelForGame).toHaveBeenCalledWith(
      'guild-123',
      101,
    );
  });

  it('should fall back to default channel when no game binding exists', async () => {
    clientService.getGuildId.mockReturnValue('guild-123');
    bindingsService.getChannelForGame.mockResolvedValue(null);
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
      'default-channel',
    );

    const result = await service.resolveChannelForEvent(101);

    expect(result).toBe('default-channel');
  });

  it('should return the default channel when no game ID is provided', async () => {
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

  it('should return null when no default channel is configured and no binding exists', async () => {
    clientService.getGuildId.mockReturnValue('guild-123');
    bindingsService.getChannelForGame.mockResolvedValue(null);
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);

    const result = await service.resolveChannelForEvent(101);

    expect(result).toBeNull();
  });

  it('should skip binding lookup when bot is not in a guild', async () => {
    clientService.getGuildId.mockReturnValue(null);
    settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
      'default-channel',
    );

    const result = await service.resolveChannelForEvent(101);

    expect(result).toBe('default-channel');
    expect(bindingsService.getChannelForGame).not.toHaveBeenCalled();
  });
});

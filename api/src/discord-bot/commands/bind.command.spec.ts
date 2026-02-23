/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BindCommand } from './bind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType } from 'discord.js';

describe('BindCommand', () => {
  let command: BindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  const mockDb = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };

  const mockInteraction = (overrides: Record<string, unknown> = {}) => ({
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    guildId: 'guild-123',
    channel: {
      id: 'channel-456',
      name: 'general',
      type: ChannelType.GuildText,
    },
    options: {
      getChannel: jest.fn().mockReturnValue(null),
      getString: jest.fn().mockReturnValue(null),
    },
    ...overrides,
  });

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BindCommand,
        {
          provide: ChannelBindingsService,
          useValue: {
            bind: jest.fn().mockResolvedValue({
              id: 'binding-uuid',
              guildId: 'guild-123',
              channelId: 'channel-456',
              channelType: 'text',
              bindingPurpose: 'game-announcements',
              gameId: null,
              config: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
            detectBehavior: jest.fn().mockReturnValue('game-announcements'),
          },
        },
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    command = module.get(BindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  describe('getDefinition', () => {
    it('should return a command definition named "bind"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('bind');
    });

    it('should not allow DM permission', () => {
      const definition = command.getDefinition();
      expect(definition.dm_permission).toBe(false);
    });
  });

  describe('handleInteraction', () => {
    it('should defer reply as ephemeral', async () => {
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should reject DM usage', async () => {
      const interaction = mockInteraction({ guildId: null });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'This command can only be used in a server.',
      );
    });

    it('should bind the current channel when no channel option is provided', async () => {
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(bindingsService.bind).toHaveBeenCalledWith(
        'guild-123',
        'channel-456',
        'text',
        'game-announcements',
        null,
        undefined,
        null,
      );
    });

    it('should reply with a success embed', async () => {
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
        }),
      );
    });

    it('should include fine-tune button when CLIENT_URL is set', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components.length).toBeGreaterThan(0);
    });
  });
});

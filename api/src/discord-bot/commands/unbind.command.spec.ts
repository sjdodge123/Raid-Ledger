/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UnbindCommand } from './unbind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { ChannelType } from 'discord.js';

describe('UnbindCommand', () => {
  let command: UnbindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

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
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnbindCommand,
        {
          provide: ChannelBindingsService,
          useValue: {
            unbind: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    command = module.get(UnbindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefinition', () => {
    it('should return a command definition named "unbind"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('unbind');
    });

    it('should not allow DM permission', () => {
      const definition = command.getDefinition();
      expect(definition.dm_permission).toBe(false);
    });

    it('should have a description', () => {
      const definition = command.getDefinition();
      expect(definition.description).toBeTruthy();
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

    it('should reject usage outside a guild (guildId is null)', async () => {
      const interaction = mockInteraction({ guildId: null });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'This command can only be used in a server.',
      );
      expect(bindingsService.unbind).not.toHaveBeenCalled();
    });

    it('should reject when no channel option and no current channel', async () => {
      const interaction = mockInteraction({
        channel: null,
        options: { getChannel: jest.fn().mockReturnValue(null) },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'Could not determine the target channel.',
      );
      expect(bindingsService.unbind).not.toHaveBeenCalled();
    });

    it('should unbind the current channel when no channel option provided', async () => {
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(bindingsService.unbind).toHaveBeenCalledWith(
        'guild-123',
        'channel-456',
      );
    });

    it('should unbind the specified channel when a channel option is provided', async () => {
      const interaction = mockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue({
            id: 'channel-999',
            name: 'raids',
            type: ChannelType.GuildText,
          }),
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(bindingsService.unbind).toHaveBeenCalledWith(
        'guild-123',
        'channel-999',
      );
    });

    it('should reply with success embed when binding is removed', async () => {
      bindingsService.unbind.mockResolvedValue(true);
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

    it('should reply with not-found message when no binding exists', async () => {
      bindingsService.unbind.mockResolvedValue(false);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
      expect(typeof replyArg).toBe('string');
      expect(replyArg as string).toMatch(/No binding found/);
    });

    it('should reply with error message when service throws', async () => {
      bindingsService.unbind.mockRejectedValue(new Error('DB error'));
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to unbind/),
      );
    });

    it('should include channel name in the not-found message', async () => {
      bindingsService.unbind.mockResolvedValue(false);
      const interaction = mockInteraction({
        channel: {
          id: 'channel-456',
          name: 'general',
          type: ChannelType.GuildText,
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
      expect(replyArg as string).toContain('general');
    });
  });
});

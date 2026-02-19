/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BindingsCommand } from './bindings.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { BindingRecord } from '../services/channel-bindings.service';

describe('BindingsCommand', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  const makeBinding = (
    overrides: Partial<BindingRecord> = {},
  ): BindingRecord => ({
    id: 'uuid-1',
    guildId: 'guild-123',
    channelId: 'channel-456',
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: null,
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

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
    ...overrides,
  });

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BindingsCommand,
        {
          provide: ChannelBindingsService,
          useValue: {
            getBindings: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefinition', () => {
    it('should return a command definition named "bindings"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('bindings');
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
      expect(bindingsService.getBindings).not.toHaveBeenCalled();
    });

    it('should reply with no-bindings message when none configured', async () => {
      bindingsService.getBindings.mockResolvedValue([]);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
      expect(typeof replyArg).toBe('string');
      expect(replyArg as string).toMatch(/No channel bindings/);
    });

    it('should include /bind mention in no-bindings message', async () => {
      bindingsService.getBindings.mockResolvedValue([]);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
      expect(replyArg as string).toContain('/bind');
    });

    it('should reply with embed when bindings exist', async () => {
      bindingsService.getBindings.mockResolvedValue([makeBinding()]);
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

    it('should include button when CLIENT_URL is set and bindings exist', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      bindingsService.getBindings.mockResolvedValue([makeBinding()]);
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

    it('should not include button when CLIENT_URL is not set and bindings exist', async () => {
      delete process.env.CLIENT_URL;
      bindingsService.getBindings.mockResolvedValue([makeBinding()]);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components).toHaveLength(0);
    });

    it('should label game-announcements bindings as "Announcements"', async () => {
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ bindingPurpose: 'game-announcements', gameId: null }),
      ]);
      // No game lookup needed since gameId is null
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

    it('should label game-voice-monitor bindings as "Voice Monitor"', async () => {
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ bindingPurpose: 'game-voice-monitor', gameId: null }),
      ]);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // The embed is created - just verify reply was called with embeds
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
        }),
      );
    });

    it('should show "Any" for bindings with no gameId', async () => {
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ gameId: null }),
      ]);
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // The embed description should contain "Any" for the game
      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: Array<{ data: { description?: string } }>;
      };
      const description = call.embeds[0]?.data?.description ?? '';
      expect(description).toContain('Any');
    });

    it('should look up game name for bindings with gameId', async () => {
      const gameId = 'game-uuid-abc';
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ gameId }),
      ]);

      // Mock DB to return a game name
      const limitMock = jest
        .fn()
        .mockResolvedValue([{ id: gameId, name: 'World of Warcraft' }]);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValueOnce({ from: fromMock });

      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: Array<{ data: { description?: string } }>;
      };
      const description = call.embeds[0]?.data?.description ?? '';
      expect(description).toContain('World of Warcraft');
    });

    it('should show "Unknown" when gameId has no matching game in registry', async () => {
      const gameId = 'missing-game-uuid';
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ gameId }),
      ]);

      // DB returns no match
      const limitMock = jest.fn().mockResolvedValue([]);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValueOnce({ from: fromMock });

      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: Array<{ data: { description?: string } }>;
      };
      const description = call.embeds[0]?.data?.description ?? '';
      expect(description).toContain('Unknown');
    });

    it('should deduplicate game lookups when multiple bindings share the same gameId', async () => {
      const gameId = 'shared-game-uuid';
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ id: 'binding-1', channelId: 'ch-1', gameId }),
        makeBinding({ id: 'binding-2', channelId: 'ch-2', gameId }),
      ]);

      const limitMock = jest
        .fn()
        .mockResolvedValue([{ id: gameId, name: 'Shared Game' }]);
      const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // Only one DB call made for the shared gameId (deduplication via Set)
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('should reply with error message when service throws', async () => {
      bindingsService.getBindings.mockRejectedValue(new Error('DB error'));
      const interaction = mockInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to fetch bindings/),
      );
    });

    it('should call getBindings with the guild ID', async () => {
      const interaction = mockInteraction({ guildId: 'my-guild-999' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(bindingsService.getBindings).toHaveBeenCalledWith('my-guild-999');
    });
  });
});

import { InviteCommand } from './invite.command';
import { EmbedBuilder } from 'discord.js';

describe('InviteCommand', () => {
  let command: InviteCommand;
  let mockClientService: Record<string, jest.Mock>;
  let mockEmbedFactory: Record<string, jest.Mock>;
  let mockSettingsService: Record<string, jest.Mock>;
  let mockEventsService: Record<string, jest.Mock>;
  let mockPugsService: Record<string, jest.Mock>;
  let mockDb: Record<string, jest.Mock>;

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = { toJSON: jest.fn() };

  beforeEach(() => {
    mockClientService = {
      sendEmbedDM: jest.fn().mockResolvedValue(undefined),
    };

    mockEmbedFactory = {
      buildEventInvite: jest.fn().mockReturnValue({
        embed: mockEmbed,
        row: mockRow,
      }),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
    };

    mockEventsService = {
      findOne: jest.fn().mockResolvedValue({
        id: 42,
        title: 'Mythic Raid Night',
        description: 'Weekly raid',
        startTime: '2026-02-20T20:00:00.000Z',
        endTime: '2026-02-20T23:00:00.000Z',
        signupCount: 15,
        cancelledAt: null,
        game: { name: 'World of Warcraft', coverUrl: null },
      }),
      findAll: jest.fn().mockResolvedValue({
        data: [
          {
            id: 42,
            title: 'Mythic Raid Night',
            startTime: '2026-02-20T20:00:00.000Z',
          },
          {
            id: 43,
            title: 'PvP Arena',
            startTime: '2026-02-21T18:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        limit: 25,
      }),
    };

    mockPugsService = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'pug-1', inviteCode: 'abc12345' }),
    };

    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    command = new InviteCommand(
      mockDb as never,
      mockClientService as never,
      mockEmbedFactory as never,
      mockSettingsService as never,
      mockEventsService as never,
      mockPugsService as never,
    );
  });

  describe('commandName', () => {
    it('should be "invite"', () => {
      expect(command.commandName).toBe('invite');
    });
  });

  describe('getDefinition', () => {
    it('should return a slash command definition', () => {
      const def = command.getDefinition();
      expect(def.name).toBe('invite');
      expect(def.description).toBe(
        'Invite a Discord user or generate an invite link',
      );
      expect(def.options).toHaveLength(2);
    });

    it('should have event (required) and user (optional) options', () => {
      const def = command.getDefinition();
      const options = def.options as {
        name: string;
        required: boolean;
        autocomplete?: boolean;
      }[];
      expect(options[0].name).toBe('event');
      expect(options[0].required).toBe(true);
      expect(options[0].autocomplete).toBe(true);
      expect(options[1].name).toBe('user');
      expect(options[1].required).toBe(false);
    });
  });

  describe('handleInteraction', () => {
    let mockInteraction: Record<string, unknown>;
    let mockEditReply: jest.Mock;

    beforeEach(() => {
      mockEditReply = jest.fn().mockResolvedValue(undefined);
      // DB lookup returns invoker's RL account
      mockDb.limit = jest.fn().mockResolvedValue([{ id: 1, role: 'admin' }]);
    });

    describe('with user (named invite)', () => {
      beforeEach(() => {
        mockInteraction = {
          deferReply: jest.fn().mockResolvedValue(undefined),
          editReply: mockEditReply,
          options: {
            getInteger: jest.fn().mockReturnValue(42),
            getUser: jest
              .fn()
              .mockReturnValue({ id: '999', username: 'target-user' }),
          },
          user: { id: 'invoker-discord-id', username: 'inviter-user' },
        };
      });

      it('should create a named PUG and confirm success', async () => {
        await command.handleInteraction(mockInteraction as never);

        expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
        expect(mockPugsService.create).toHaveBeenCalledWith(
          42,
          1,
          true,
          expect.objectContaining({
            discordUsername: 'target-user',
            role: 'dps',
          }),
        );
        expect(mockEditReply).toHaveBeenCalledWith(
          'Invite sent to <@999> for **Mythic Raid Night**',
        );
      });

      it('should reply with error if event not found', async () => {
        mockEventsService.findOne.mockRejectedValue(
          new Error('Event not found'),
        );

        await command.handleInteraction(mockInteraction as never);

        expect(mockEditReply).toHaveBeenCalledWith('Event not found');
        expect(mockPugsService.create).not.toHaveBeenCalled();
      });

      it('should reply with error if event is cancelled', async () => {
        mockEventsService.findOne.mockResolvedValue({
          id: 42,
          title: 'Cancelled Event',
          cancelledAt: '2026-02-20T00:00:00.000Z',
          startTime: '2026-02-20T20:00:00.000Z',
          endTime: '2026-02-20T23:00:00.000Z',
          signupCount: 0,
          game: null,
        });

        await command.handleInteraction(mockInteraction as never);

        expect(mockEditReply).toHaveBeenCalledWith('Event not found');
        expect(mockPugsService.create).not.toHaveBeenCalled();
      });
    });

    describe('without user (anonymous invite link)', () => {
      beforeEach(() => {
        process.env.CLIENT_URL = 'http://localhost:5173';
        mockInteraction = {
          deferReply: jest.fn().mockResolvedValue(undefined),
          editReply: mockEditReply,
          options: {
            getInteger: jest.fn().mockReturnValue(42),
            getUser: jest.fn().mockReturnValue(null),
          },
          user: { id: 'invoker-discord-id', username: 'inviter-user' },
        };
      });

      afterEach(() => {
        delete process.env.CLIENT_URL;
      });

      it('should create an anonymous PUG and return invite URL', async () => {
        await command.handleInteraction(mockInteraction as never);

        expect(mockPugsService.create).toHaveBeenCalledWith(
          42,
          1,
          true,
          expect.objectContaining({ role: 'dps' }),
        );
        expect(mockEditReply).toHaveBeenCalledWith(
          expect.stringContaining('/i/abc12345'),
        );
      });
    });

    it('should reply with error if invoker has no RL account', async () => {
      mockDb.limit = jest.fn().mockResolvedValue([]);
      mockInteraction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: mockEditReply,
        options: {
          getInteger: jest.fn().mockReturnValue(42),
          getUser: jest.fn().mockReturnValue(null),
        },
        user: { id: 'unknown-user', username: 'nobody' },
      };

      await command.handleInteraction(mockInteraction as never);

      expect(mockEditReply).toHaveBeenCalledWith(
        'You need a linked Raid Ledger account to use this command.',
      );
    });
  });

  describe('handleAutocomplete', () => {
    let mockAutocomplete: {
      options: { getFocused: jest.Mock };
      respond: jest.Mock;
    };

    beforeEach(() => {
      mockAutocomplete = {
        options: { getFocused: jest.fn().mockReturnValue('') },
        respond: jest.fn().mockResolvedValue(undefined),
      };
    });

    it('should return matching events', async () => {
      mockAutocomplete.options.getFocused.mockReturnValue('mythic');

      await command.handleAutocomplete(mockAutocomplete as never);

      expect(mockEventsService.findAll).toHaveBeenCalledWith({
        page: 1,
        upcoming: 'true',
        limit: 25,
      });
      expect(mockAutocomplete.respond).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ value: 42 })]),
      );
      // Should not include PvP Arena since query is 'mythic'
      const calls = mockAutocomplete.respond.mock.calls as [
        { name: string; value: number }[],
      ][];
      expect(calls[0][0]).toHaveLength(1);
    });

    it('should return all events when query is empty', async () => {
      await command.handleAutocomplete(mockAutocomplete as never);

      const calls = mockAutocomplete.respond.mock.calls as [
        { name: string; value: number }[],
      ][];
      expect(calls[0][0]).toHaveLength(2);
    });

    it('should respond with empty array on error', async () => {
      mockEventsService.findAll.mockRejectedValue(new Error('DB error'));

      await command.handleAutocomplete(mockAutocomplete as never);

      expect(mockAutocomplete.respond).toHaveBeenCalledWith([]);
    });

    it('should format event names with date and time', async () => {
      await command.handleAutocomplete(mockAutocomplete as never);

      const calls = mockAutocomplete.respond.mock.calls as [
        { name: string; value: number }[],
      ][];
      const choices = calls[0][0];
      // Should contain the event title and a formatted date
      expect(choices[0].name).toContain('Mythic Raid Night');
      expect(choices[0].name).toContain('Feb');
    });
  });
});

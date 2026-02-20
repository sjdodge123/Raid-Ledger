import { InviteCommand } from './invite.command';
import { EmbedBuilder } from 'discord.js';

describe('InviteCommand', () => {
  let command: InviteCommand;
  let mockClientService: Record<string, jest.Mock>;
  let mockEmbedFactory: Record<string, jest.Mock>;
  let mockSettingsService: Record<string, jest.Mock>;
  let mockEventsService: Record<string, jest.Mock>;

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
    };

    command = new InviteCommand(
      mockClientService as never,
      mockEmbedFactory as never,
      mockSettingsService as never,
      mockEventsService as never,
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
      expect(def.description).toBe('Invite a Discord user to an event');
      expect(def.options).toHaveLength(2);
    });

    it('should have event and user options', () => {
      const def = command.getDefinition();
      const options = def.options as { name: string; required: boolean }[];
      expect(options[0].name).toBe('event');
      expect(options[0].required).toBe(true);
      expect(options[1].name).toBe('user');
      expect(options[1].required).toBe(true);
    });
  });

  describe('handleInteraction', () => {
    let mockInteraction: Record<string, unknown>;
    let mockEditReply: jest.Mock;

    beforeEach(() => {
      mockEditReply = jest.fn().mockResolvedValue(undefined);
      mockInteraction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: mockEditReply,
        options: {
          getInteger: jest.fn().mockReturnValue(42),
          getUser: jest
            .fn()
            .mockReturnValue({ id: '999', username: 'target-user' }),
        },
        user: { username: 'inviter-user' },
      };
    });

    it('should send a DM and confirm success', async () => {
      await command.handleInteraction(mockInteraction as never);

      expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
      expect(mockEmbedFactory.buildEventInvite).toHaveBeenCalled();
      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        '999',
        mockEmbed,
        mockRow,
      );
      expect(mockEditReply).toHaveBeenCalledWith(
        'Invite sent to <@999> for **Mythic Raid Night**',
      );
    });

    it('should reply with error if event not found', async () => {
      mockEventsService.findOne.mockRejectedValue(new Error('Event not found'));

      await command.handleInteraction(mockInteraction as never);

      expect(mockEditReply).toHaveBeenCalledWith('Event not found');
      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
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
      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should reply with error if DM fails', async () => {
      mockClientService.sendEmbedDM.mockRejectedValue(
        new Error('Cannot send DM'),
      );

      await command.handleInteraction(mockInteraction as never);

      expect(mockEditReply).toHaveBeenCalledWith(
        'Could not send DM to <@999> — they may have DMs disabled',
      );
    });

    it('should pass inviter username to buildEventInvite', async () => {
      await command.handleInteraction(mockInteraction as never);

      expect(mockEmbedFactory.buildEventInvite).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42 }),
        expect.objectContaining({ communityName: 'Test Guild' }),
        'inviter-user',
      );
    });
  });
});

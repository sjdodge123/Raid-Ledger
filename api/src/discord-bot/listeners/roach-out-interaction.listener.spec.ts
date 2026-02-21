/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { RoachOutInteractionListener } from './roach-out-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ROACH_OUT_BUTTON_IDS } from '../discord-bot.constants';

/** Create a minimal ButtonInteraction mock */
function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
) {
  const interaction = {
    isButton: () => true,
    customId,
    id: 'interaction-id-1',
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    deferUpdate: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    message: {
      embeds: [
        {
          description: 'Mythic Raid starts in 15 minutes!',
          title: 'Event Reminder',
          color: 0xf59e0b,
        },
      ],
      components: [],
      edit: jest.fn().mockResolvedValue(undefined),
    },
  };
  return interaction;
}

describe('RoachOutInteractionListener', () => {
  let module: TestingModule;
  let listener: any; // Use any to access private methods directly
  let mockClientService: {
    getClient: jest.Mock;
    getGuildId: jest.Mock;
    editEmbed: jest.Mock;
  };
  let mockSignupsService: {
    findByDiscordUser: jest.Mock;
    cancelByDiscordUser: jest.Mock;
  };
  let mockEventsService: {
    buildEmbedEventData: jest.Mock;
  };
  let mockDb: {
    select: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
    limit: jest.Mock;
  };

  beforeEach(async () => {
    mockClientService = {
      getClient: jest.fn().mockReturnValue({
        on: jest.fn(),
        removeListener: jest.fn(),
      }),
      getGuildId: jest.fn().mockReturnValue(null),
      editEmbed: jest.fn().mockResolvedValue(undefined),
    };

    mockSignupsService = {
      findByDiscordUser: jest.fn(),
      cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
    };

    mockEventsService = {
      buildEmbedEventData: jest.fn(),
    };

    const mockChain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    mockDb = mockChain as any;

    module = await Test.createTestingModule({
      providers: [
        RoachOutInteractionListener,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: DiscordEmbedFactory, useValue: {} },
        { provide: SettingsService, useValue: {} },
      ],
    }).compile();

    listener = module.get(RoachOutInteractionListener);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('onBotConnected', () => {
    it('should register interaction handler on bot connect', () => {
      const mockClient = {
        on: jest.fn(),
        removeListener: jest.fn(),
      };
      mockClientService.getClient.mockReturnValue(mockClient);

      listener.onBotConnected();

      expect(mockClient.on).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('should remove previous handler on reconnect', () => {
      const mockClient = {
        on: jest.fn(),
        removeListener: jest.fn(),
      };
      mockClientService.getClient.mockReturnValue(mockClient);

      // First connect
      listener.onBotConnected();
      // Second connect (reconnect)
      listener.onBotConnected();

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });
  });

  describe('handleRoachOutClick', () => {
    it('should show confirmation prompt when user is signed up', async () => {
      const futureDate = new Date(Date.now() + 60000);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 42,
          title: 'Mythic Raid',
          cancelledAt: null,
          duration: [futureDate, new Date(futureDate.getTime() + 7200000)],
        },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue({
        id: 1,
        status: 'signed_up',
      });

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );

      await listener['handleRoachOutClick'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'Are you sure you want to roach out of **Mythic Raid**?',
          ),
          components: expect.any(Array),
        }),
      );
    });

    it('should reply "not signed up" when user has no signup', async () => {
      const futureDate = new Date(Date.now() + 60000);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 42,
          title: 'Mythic Raid',
          cancelledAt: null,
          duration: [futureDate, new Date(futureDate.getTime() + 7200000)],
        },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );

      await listener['handleRoachOutClick'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
    });

    it('should reply "cancelled" when event is cancelled', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 42,
          title: 'Mythic Raid',
          cancelledAt: new Date(),
          duration: [new Date(), new Date()],
        },
      ]);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );

      await listener['handleRoachOutClick'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
      });
    });

    it('should show warning when event has already started', async () => {
      const pastDate = new Date(Date.now() - 60000);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 42,
          title: 'Mythic Raid',
          cancelledAt: null,
          duration: [pastDate, new Date(pastDate.getTime() + 7200000)],
        },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue({
        id: 1,
        status: 'signed_up',
      });

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );

      await listener['handleRoachOutClick'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('This event has already started.'),
        }),
      );
    });
  });

  describe('handleConfirm', () => {
    it('should remove signup and confirm on successful roach out', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, title: 'Mythic Raid', cancelledAt: null },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue({
        id: 1,
        status: 'signed_up',
      });
      mockSignupsService.cancelByDiscordUser.mockResolvedValue(undefined);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );

      await listener['handleConfirm'](interaction, 42);

      expect(mockSignupsService.cancelByDiscordUser).toHaveBeenCalledWith(
        42,
        'discord-user-123',
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            "You've roached out of **Mythic Raid**.",
          ),
          components: [],
        }),
      );
    });

    it('should handle user not signed up on confirm', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, title: 'Mythic Raid', cancelledAt: null },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );

      await listener['handleConfirm'](interaction, 42);

      expect(mockSignupsService.cancelByDiscordUser).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
        components: [],
      });
    });

    it('should handle cancelled event on confirm', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, title: 'Mythic Raid', cancelledAt: new Date() },
      ]);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );

      await listener['handleConfirm'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
        components: [],
      });
    });
  });

  describe('handleCancel', () => {
    it('should dismiss the confirmation without changes', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
      );

      await listener['handleCancel'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Cancelled. Your signup is unchanged.',
        components: [],
      });
    });
  });

  describe('onBotConnected — edge cases', () => {
    it('should do nothing when getClient returns null', () => {
      mockClientService.getClient.mockReturnValue(null);

      // Should not throw
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      expect(() => listener.onBotConnected()).not.toThrow();
    });
  });

  describe('handleButtonInteraction — routing and malformed inputs', () => {
    it('should ignore interactions with wrong part count (no colon)', async () => {
      const mockClient = {
        on: jest.fn(),
        removeListener: jest.fn(),
      };
      mockClientService.getClient.mockReturnValue(mockClient);
      listener.onBotConnected();

      const [, boundHandler] = mockClient.on.mock.calls[0] as [
        string,
        (interaction: unknown) => Promise<void>,
      ];

      const nonButtonInteraction = { isButton: () => false };
      // Should silently ignore non-button interactions
      await boundHandler(nonButtonInteraction);

      expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
    });

    it('should ignore interactions with too many parts (extra colons)', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42:extra`,
      );
      // parts.length !== 2 → should return early
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
    });

    it('should ignore interactions with NaN eventId', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:notanumber`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
    });

    it('should ignore interactions with unknown action prefix', async () => {
      const interaction = makeButtonInteraction('unknown_action:42');
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
    });

    it('should use deferUpdate for cancel actions instead of deferReply', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('should use deferReply for roach_out action', async () => {
      const futureDate = new Date(Date.now() + 60000);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 42,
          title: 'Mythic Raid',
          cancelledAt: null,
          duration: [futureDate, new Date(futureDate.getTime() + 7200000)],
        },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue({
        id: 1,
        status: 'signed_up',
      });

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should return early when deferReply throws (expired interaction)', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );
      interaction.deferReply.mockRejectedValueOnce(
        new Error('Unknown Interaction'),
      );

      await listener['handleButtonInteraction'](interaction);

      // Should not attempt to do any signup lookups after defer failure
      expect(mockSignupsService.findByDiscordUser).not.toHaveBeenCalled();
    });

    it('should return early when deferUpdate throws for cancel', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
      );
      interaction.deferUpdate.mockRejectedValueOnce(
        new Error('Unknown Interaction'),
      );

      // Should not throw
      await expect(
        listener['handleButtonInteraction'](interaction),
      ).resolves.not.toThrow();
    });

    it('should call safeEditReply with error message when action throws', async () => {
      mockDb.limit.mockRejectedValueOnce(new Error('DB Error'));

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:42`,
      );

      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again.',
      });
    });
  });

  describe('handleRoachOutClick — event not found', () => {
    it('should reply "event not found" when db returns no event', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:999`,
      );

      await listener['handleRoachOutClick'](interaction, 999);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
    });
  });

  describe('handleConfirm — event not found', () => {
    it('should reply "event not found" when db returns no event on confirm', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:999`,
      );

      await listener['handleConfirm'](interaction, 999);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
        components: [],
      });
    });

    it('should reply gracefully when cancelByDiscordUser throws', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, title: 'Mythic Raid', cancelledAt: null },
      ]);
      mockSignupsService.findByDiscordUser.mockResolvedValue({
        id: 1,
        status: 'signed_up',
      });
      mockSignupsService.cancelByDiscordUser.mockRejectedValueOnce(
        new Error('Constraint violation'),
      );

      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );

      await listener['handleConfirm'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
        components: [],
      });
    });
  });

  describe('isDiscordInteractionError', () => {
    it('should return true for error code 40060 (interaction already acknowledged)', () => {
      const err = {
        code: 40060,
        message: 'Interaction has already been acknowledged',
      };
      expect(listener['isDiscordInteractionError'](err)).toBe(true);
    });

    it('should return true for error code 10062 (unknown interaction)', () => {
      const err = { code: 10062, message: 'Unknown interaction' };
      expect(listener['isDiscordInteractionError'](err)).toBe(true);
    });

    it('should return false for other error codes', () => {
      const err = { code: 50013, message: 'Missing Permissions' };
      expect(listener['isDiscordInteractionError'](err)).toBe(false);
    });

    it('should return false for null', () => {
      expect(listener['isDiscordInteractionError'](null)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(listener['isDiscordInteractionError']('string error')).toBe(false);
      expect(listener['isDiscordInteractionError'](42)).toBe(false);
    });

    it('should return false for object without code property', () => {
      expect(
        listener['isDiscordInteractionError']({ message: 'no code' }),
      ).toBe(false);
    });
  });

  describe('safeEditReply', () => {
    it('should silently swallow Discord interaction error codes', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
      );
      interaction.editReply.mockRejectedValueOnce({
        code: 40060,
        message: 'Interaction already acknowledged',
      });

      await expect(
        listener['safeEditReply'](interaction, { content: 'test' }),
      ).resolves.not.toThrow();
    });

    it('should re-throw non-Discord errors from editReply', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CANCEL}:42`,
      );
      const networkError = new Error('Network error');
      interaction.editReply.mockRejectedValueOnce(networkError);

      await expect(
        listener['safeEditReply'](interaction, { content: 'test' }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('updateChannelEmbeds', () => {
    it('should return early when guildId is null', async () => {
      mockClientService.getGuildId.mockReturnValue(null);
      mockEventsService.buildEmbedEventData.mockResolvedValue({});

      // Should not throw, and should not try to query discordEventMessages
      await expect(listener['updateChannelEmbeds'](42)).resolves.not.toThrow();
    });

    it('should not call editEmbed when no channel records exist', async () => {
      mockClientService.getGuildId.mockReturnValue('guild-123');
      mockEventsService.buildEmbedEventData.mockResolvedValue({ id: 42 });
      // db returns empty records
      mockDb.limit.mockResolvedValueOnce([]);
      // Override the full chain for the second query (no .limit)
      const mockChainNoLimit = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      // Replace db for this test
      (listener as unknown as { db: unknown }).db = mockChainNoLimit;

      await expect(listener['updateChannelEmbeds'](42)).resolves.not.toThrow();
      expect(mockClientService.editEmbed).not.toHaveBeenCalled();
    });

    it('should handle buildEmbedEventData throwing gracefully', async () => {
      mockEventsService.buildEmbedEventData.mockRejectedValueOnce(
        new Error('Event not found'),
      );

      // Should not throw (error is caught internally)
      await expect(listener['updateChannelEmbeds'](999)).resolves.not.toThrow();
    });
  });

  describe('editReminderEmbed', () => {
    it('should return early when original message has no embed', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );
      interaction.message.embeds = [];

      // Should not throw
      await expect(
        listener['editReminderEmbed'](interaction, 'Mythic Raid'),
      ).resolves.not.toThrow();

      expect(interaction.message.edit).not.toHaveBeenCalled();
    });

    it('should edit original message when embed exists', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );
      // message.edit is already a jest.fn on the mock

      await listener['editReminderEmbed'](interaction, 'Mythic Raid');

      expect(interaction.message.edit).toHaveBeenCalled();
    });

    it('should handle message.edit failing gracefully', async () => {
      const interaction = makeButtonInteraction(
        `${ROACH_OUT_BUTTON_IDS.CONFIRM}:42`,
      );
      interaction.message.edit.mockRejectedValueOnce(
        new Error('Unknown Message'),
      );

      // Should not throw — warns but continues
      await expect(
        listener['editReminderEmbed'](interaction, 'Mythic Raid'),
      ).resolves.not.toThrow();
    });
  });
});

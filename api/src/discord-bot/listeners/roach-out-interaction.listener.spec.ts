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
  let listener: any;
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
});

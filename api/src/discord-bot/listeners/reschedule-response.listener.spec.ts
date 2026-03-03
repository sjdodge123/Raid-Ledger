/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Test, TestingModule } from '@nestjs/testing';
import { RescheduleResponseListener } from './reschedule-response.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/** Create a minimal ButtonInteraction mock */
function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
  messageOverrides: {
    embeds?: Array<{ description: string; title?: string }>;
    components?: unknown[];
  } = {},
) {
  const message = {
    embeds: messageOverrides.embeds ?? [
      { description: 'Your event has been rescheduled.', title: 'Rescheduled' },
    ],
    components: messageOverrides.components ?? [],
    edit: jest.fn().mockResolvedValue(undefined),
  };

  const interaction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    id: 'btn-interaction-1',
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    message,
  };
  return interaction;
}

/** Create a minimal StringSelectMenuInteraction mock */
function makeSelectMenuInteraction(
  customId: string,
  values: string[],
  userId: string = 'discord-user-123',
) {
  const mockMessages = new Map<string, unknown>();
  const interaction = {
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId,
    values,
    id: 'select-interaction-1',
    user: { id: userId, username: 'TestUser', avatar: null },
    replied: false,
    deferred: false,
    client: { user: { id: 'bot-user-id' } },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    channel: {
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMessages),
      },
    },
    _mockMessages: mockMessages,
  };
  return interaction;
}

describe('RescheduleResponseListener', () => {
  let module: TestingModule;
  let listener: any;
  let mockDb: MockDb;
  let mockClientService: { getClient: jest.Mock };
  let mockSignupsService: {
    findByDiscordUser: jest.Mock;
    confirmSignup: jest.Mock;
  };
  let mockEventsService: object;
  let mockCharactersService: {
    findAllForUser: jest.Mock;
    findOne: jest.Mock;
  };
  let mockEmbedSyncQueue: { enqueue: jest.Mock };
  let mockEmojiService: {
    getClassEmojiComponent: jest.Mock;
    getRoleEmojiComponent: jest.Mock;
  };

  const mockEvent = {
    id: 42,
    title: 'Mythic Raid Night',
    cancelledAt: null,
    gameId: null,
    slotConfig: null,
  };

  const mockCancelledEvent = {
    id: 42,
    title: 'Mythic Raid Night',
    cancelledAt: new Date('2026-01-01'),
    gameId: null,
    slotConfig: null,
  };

  const mockSignup = { id: 101, eventId: 42, status: 'signed_up' };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    mockClientService = {
      getClient: jest.fn().mockReturnValue(null),
    };

    mockSignupsService = {
      findByDiscordUser: jest.fn().mockResolvedValue(null),
      confirmSignup: jest.fn().mockResolvedValue({ id: 101 }),
    };

    mockEventsService = {};

    mockCharactersService = {
      findAllForUser: jest
        .fn()
        .mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Arthas' }),
    };

    mockEmbedSyncQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    mockEmojiService = {
      getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
      getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        RescheduleResponseListener,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: CharactersService, useValue: mockCharactersService },
        { provide: EmbedSyncQueueService, useValue: mockEmbedSyncQueue },
        { provide: DiscordEmojiService, useValue: mockEmojiService },
      ],
    }).compile();

    listener = module.get(RescheduleResponseListener);
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  // ─── Bot connection ─────────────────────────────────────────────────

  describe('onBotConnected', () => {
    it('registers interaction handler when bot connects', () => {
      const mockClient = { on: jest.fn(), removeListener: jest.fn() };
      mockClientService.getClient.mockReturnValue(mockClient);

      listener.onBotConnected();

      expect(mockClient.on).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('does nothing when client is not available', () => {
      mockClientService.getClient.mockReturnValue(null);
      // Should not throw
      expect(() => listener.onBotConnected()).not.toThrow();
    });

    it('removes previous handler on reconnect to avoid duplicate handlers', () => {
      const mockClient = { on: jest.fn(), removeListener: jest.fn() };
      mockClientService.getClient.mockReturnValue(mockClient);

      listener.onBotConnected();
      listener.onBotConnected();

      expect(mockClient.removeListener).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });
  });

  // ─── Button routing ──────────────────────────────────────────────────

  describe('handleButtonInteraction — routing', () => {
    it('ignores interactions with wrong custom ID format (no colon)', async () => {
      const interaction = makeButtonInteraction('reschedule_confirmNO_COLON');
      await listener['handleButtonInteraction'](interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('ignores interactions with non-reschedule custom IDs', async () => {
      const interaction = makeButtonInteraction('signup:42');
      await listener['handleButtonInteraction'](interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('ignores interactions with non-numeric event ID', async () => {
      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:not-a-number`,
      );
      await listener['handleButtonInteraction'](interaction);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('defers reply for valid confirm interaction', async () => {
      // Event lookup — return mock event
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      // User lookup — no linked user
      mockDb.limit.mockResolvedValueOnce([]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('returns error reply when deferReply throws', async () => {
      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      interaction.deferReply.mockRejectedValueOnce(new Error('Network error'));

      await listener['handleButtonInteraction'](interaction);

      // Should not proceed to editReply since defer failed
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  // ─── Confirm flow — edge cases ───────────────────────────────────────

  describe('handleConfirm — edge cases', () => {
    it('replies "Event not found." when event does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no event found
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleConfirm'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
    });

    it('replies "This event has been cancelled." for cancelled events', async () => {
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleConfirm'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
      });
    });

    it('replies "You\'re not signed up" when user has no signup', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleConfirm'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
    });
  });

  // ─── Confirm flow — unlinked user ────────────────────────────────────

  describe('handleUnlinkedConfirm', () => {
    it('re-confirms immediately for non-MMO events', async () => {
      // Event lookup → no linked user
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user lookup — none
      mockDb.limit.mockResolvedValueOnce([]);
      // reconfirmSignup — unlinked: find signup by discordUserId
      mockDb.limit.mockResolvedValueOnce([mockSignup]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're confirmed for **Mythic Raid Night**.",
      });
      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-confirm',
      );
    });

    it('shows role select for unlinked user on MMO event', async () => {
      const mmoEvent = {
        ...mockEvent,
        gameId: 10,
        slotConfig: { type: 'mmo' },
      };
      // Event lookup
      mockDb.limit.mockResolvedValueOnce([mmoEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user lookup — none
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      // Should show role select (editReply with components)
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          components: expect.any(Array),
        }),
      );
    });
  });

  // ─── Confirm flow — linked user ──────────────────────────────────────

  describe('handleLinkedConfirm', () => {
    const linkedUser = { id: 5 };

    it('re-confirms immediately when no game is attached', async () => {
      // Event lookup (no gameId)
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      // Linked user found
      mockDb.limit.mockResolvedValueOnce([linkedUser]);
      // reconfirmSignup: find signup by userId
      mockDb.limit.mockResolvedValueOnce([mockSignup]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're confirmed for **Mythic Raid Night**.",
      });
      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-confirm',
      );
    });

    it('auto-selects single character for non-MMO event and re-confirms', async () => {
      const eventWithGame = { ...mockEvent, gameId: 5, slotConfig: null };
      const character = { id: 'char-1', name: 'Arthas', isMain: true };

      mockDb.limit.mockResolvedValueOnce([eventWithGame]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      mockDb.limit.mockResolvedValueOnce([linkedUser]); // linked user
      mockDb.limit.mockResolvedValueOnce([{ id: 5, name: 'WoW' }]); // game
      mockCharactersService.findAllForUser.mockResolvedValue({
        data: [character],
      });
      // reconfirmSignup: find signup
      mockDb.limit.mockResolvedValueOnce([mockSignup]);
      mockCharactersService.findOne.mockResolvedValue(character);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're confirmed for **Mythic Raid Night** with **Arthas**.",
      });
      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-confirm',
      );
    });

    it('shows character select when user has multiple characters', async () => {
      const eventWithGame = { ...mockEvent, gameId: 5, slotConfig: null };
      const characters = [
        { id: 'char-1', name: 'Arthas', isMain: true, class: 'Paladin' },
        { id: 'char-2', name: 'Sylvanas', isMain: false, class: 'Hunter' },
      ];

      mockDb.limit.mockResolvedValueOnce([eventWithGame]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      mockDb.limit.mockResolvedValueOnce([linkedUser]);
      mockDb.limit.mockResolvedValueOnce([{ id: 5, name: 'WoW' }]);
      mockCharactersService.findAllForUser.mockResolvedValue({
        data: characters,
      });

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      // Should show character select
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.any(Array),
        }),
      );
    });

    it('shows character select for MMO event with 1+ character', async () => {
      const mmoEvent = { ...mockEvent, gameId: 5, slotConfig: { type: 'mmo' } };
      const character = {
        id: 'char-1',
        name: 'Arthas',
        isMain: true,
        class: 'Paladin',
      };

      mockDb.limit.mockResolvedValueOnce([mmoEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      mockDb.limit.mockResolvedValueOnce([linkedUser]);
      mockDb.limit.mockResolvedValueOnce([{ id: 5, name: 'WoW' }]);
      mockCharactersService.findAllForUser.mockResolvedValue({
        data: [character],
      });

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Pick a character'),
          components: expect.any(Array),
        }),
      );
    });

    it('shows role select for MMO event when user has no characters', async () => {
      const mmoEvent = { ...mockEvent, gameId: 5, slotConfig: { type: 'mmo' } };

      mockDb.limit.mockResolvedValueOnce([mmoEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
      mockDb.limit.mockResolvedValueOnce([linkedUser]);
      mockDb.limit.mockResolvedValueOnce([{ id: 5, name: 'WoW' }]);
      mockCharactersService.findAllForUser.mockResolvedValue({ data: [] });

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      // Should show role select
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('role'),
          components: expect.any(Array),
        }),
      );
    });
  });

  // ─── Decline flow ─────────────────────────────────────────────────────

  describe('handleDecline', () => {
    it('sets signup status to declined and deletes roster assignment', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      // update sets status to declined
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'declined' }),
      );

      // delete roster assignment
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('replies with "No worries!" message after successful decline', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No worries!'),
        }),
      );
    });

    it('enqueues embed sync after decline', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-decline',
      );
    });

    it('replies "Event not found." when event does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no event
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('replies "This event has been cancelled." for cancelled events', async () => {
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('replies "You\'re not signed up" when user has no signup', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(null);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "You're not signed up for this event.",
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('clears roachedOutAt when declining', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleDecline'](interaction, 42);

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ roachedOutAt: null }),
      );
    });
  });

  // ─── Select menu routing ─────────────────────────────────────────────

  describe('handleSelectMenuInteraction — routing', () => {
    it('ignores select menus with wrong custom ID format (too many parts)', async () => {
      const interaction = makeSelectMenuInteraction(
        'reschedule_char_select:42:char-1:extra',
        ['char-1'],
      );
      await listener['handleSelectMenuInteraction'](interaction);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('ignores select menus with non-reschedule custom IDs', async () => {
      const interaction = makeSelectMenuInteraction('pug_char_select:42', [
        'char-1',
      ]);
      await listener['handleSelectMenuInteraction'](interaction);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('ignores select menus with non-numeric event ID', async () => {
      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:not-a-number`,
        ['char-1'],
      );
      await listener['handleSelectMenuInteraction'](interaction);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('defers update for valid character select', async () => {
      // linked user lookup
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]);
      // event lookup
      mockDb.limit.mockResolvedValueOnce([{ ...mockEvent, slotConfig: null }]);
      // reconfirmSignup: find signup
      mockDb.limit.mockResolvedValueOnce([mockSignup]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleSelectMenuInteraction'](interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
    });
  });

  // ─── Character select handler ────────────────────────────────────────

  describe('handleCharacterSelect', () => {
    it('replies with confirmation message for non-MMO event', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // event (no slotConfig)
      mockDb.limit.mockResolvedValueOnce([mockSignup]); // reconfirmSignup signup

      mockCharactersService.findOne.mockResolvedValue({
        id: 'char-1',
        name: 'Arthas',
      });

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleCharacterSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Arthas'),
          components: [],
        }),
      );
      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-confirm',
      );
    });

    it('replies "Could not find your linked account" if user not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no linked user

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleCharacterSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Could not find your linked account. Please try again.',
        components: [],
      });
    });

    it('replies "Event not found." if event does not exist during character select', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([]); // no event

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleCharacterSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
        components: [],
      });
    });

    it('replies "This event has been cancelled." if event cancelled during character select', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]); // cancelled event

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleCharacterSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
        components: [],
      });
    });

    it('shows role select for MMO event after character selection', async () => {
      const mmoEvent = {
        ...mockEvent,
        gameId: 5,
        slotConfig: { type: 'mmo' },
      };
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mmoEvent]); // event

      mockCharactersService.findOne.mockResolvedValue({
        id: 'char-1',
        name: 'Arthas',
        role: 'tank',
        roleOverride: null,
      });

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleCharacterSelect'](interaction, 42);

      // Should call showRoleSelect — editReply with role select menu
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Arthas'),
          components: expect.any(Array),
        }),
      );
    });
  });

  // ─── Role select handler ─────────────────────────────────────────────

  describe('handleRoleSelect', () => {
    it('re-confirms for linked user with single role selection', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // event
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]); // reconfirmSignup signup

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Tank'),
          components: [],
        }),
      );
      expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
        42,
        'reschedule-confirm',
      );
    });

    it('re-confirms with multiple roles for linked user', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank', 'healer'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Tank, Healer'),
          components: [],
        }),
      );
    });

    it('re-confirms for unlinked user with role selection', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // event
      mockDb.limit.mockResolvedValueOnce([]); // no linked user
      // unlinked signup lookup
      mockDb.limit.mockResolvedValueOnce([mockSignup]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['dps'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Dps'),
          components: [],
        }),
      );
    });

    it('replies "Event not found." if event does not exist during role select', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no event

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Event not found.',
        components: [],
      });
    });

    it('replies "This event has been cancelled." if event cancelled during role select', async () => {
      mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'This event has been cancelled.',
        components: [],
      });
    });

    it('includes character name in reply when characterId is provided', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]);
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]);
      mockCharactersService.findOne.mockResolvedValue({
        id: 'char-1',
        name: 'Arthas',
      });

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42:char-1`,
        ['healer'],
      );
      await listener['handleRoleSelect'](interaction, 42, 'char-1');

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Arthas'),
          components: [],
        }),
      );
    });
  });

  // ─── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('replies "Something went wrong" when confirm flow throws unexpectedly', async () => {
      mockDb.limit.mockRejectedValueOnce(new Error('DB error'));
      mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again.',
      });
    });

    it('replies "Something went wrong" when decline flow throws unexpectedly', async () => {
      mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
        new Error('DB error'),
      );
      mockDb.limit.mockResolvedValueOnce([mockEvent]);

      const interaction = makeButtonInteraction(
        `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
      );
      await listener['handleButtonInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again.',
      });
    });

    it('replies "Something went wrong" when select menu flow throws unexpectedly', async () => {
      mockDb.limit.mockRejectedValueOnce(new Error('DB error'));

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT}:42`,
        ['char-1'],
      );
      await listener['handleSelectMenuInteraction'](interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    });
  });
});

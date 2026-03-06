import { Test, TestingModule } from '@nestjs/testing';
import { RescheduleResponseListener } from './reschedule-response.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/** Test-friendly interface exposing private members needed by specs */
interface TestableRescheduleResponseListener {
  onBotConnected: () => void;
  handleButtonInteraction: (interaction: unknown) => Promise<void>;
  handleConfirm: (interaction: unknown, eventId: number) => Promise<void>;
  handleTentative: (interaction: unknown, eventId: number) => Promise<void>;
  handleDecline: (interaction: unknown, eventId: number) => Promise<void>;
  handleSelectMenuInteraction: (interaction: unknown) => Promise<void>;
  handleCharacterSelect: (
    interaction: unknown,
    eventId: number,
  ) => Promise<void>;
  handleRoleSelect: (
    interaction: unknown,
    eventId: number,
    characterId?: string,
  ) => Promise<void>;
}

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

describe('RescheduleResponseListener — menus', () => {
  let module: TestingModule;

  let listener: TestableRescheduleResponseListener;
  let mockDb: MockDb;
  let mockClientService: { getClient: jest.Mock };
  let mockSignupsService: {
    findByDiscordUser: jest.Mock;
    confirmSignup: jest.Mock;
    updateStatus: jest.Mock;
  };
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

  const mockSignup = {
    id: 101,
    eventId: 42,
    status: 'signed_up',
    discordUserId: 'discord-user-1',
    user: { id: 41 },
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    mockClientService = {
      getClient: jest.fn().mockReturnValue(null),
    };

    mockSignupsService = {
      findByDiscordUser: jest.fn().mockResolvedValue(null),
      confirmSignup: jest.fn().mockResolvedValue({ id: 101 }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

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
        { provide: CharactersService, useValue: mockCharactersService },
        { provide: EmbedSyncQueueService, useValue: mockEmbedSyncQueue },
        { provide: DiscordEmojiService, useValue: mockEmojiService },
      ],
    }).compile();

    const instance: unknown = module.get(RescheduleResponseListener);
    listener = instance as TestableRescheduleResponseListener;
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  // ─── Bot connection ─────────────────────────────────────────────────

  describe('handleSelectMenuInteraction — routing', () => {
    it('ignores select menus with wrong custom ID format (too many parts)', async () => {
      const interaction = makeSelectMenuInteraction(
        'reschedule_char_select:42:char-1:extra:more',
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
      // ensureRosterAssignment — no existing assignment (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

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
      // ensureRosterAssignment — no existing assignment (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

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
      // ensureRosterAssignment — no existing assignment (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

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
      // ensureRosterAssignment — no existing assignment (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);

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
      // ensureRosterAssignment — no existing assignment (slotConfig null → early return)
      mockDb.limit.mockResolvedValueOnce([]);
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

  // ─── Auto-slotting on reconfirm ─────────────────────────────────────

  describe('ensureRosterAssignment (auto-slotting)', () => {
    const mmoEvent = {
      id: 42,
      title: 'Mythic Raid Night',
      cancelledAt: null,
      gameId: 10,
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
    };

    it('creates roster assignment for MMO event when none exists', async () => {
      mockDb.limit.mockResolvedValueOnce([mmoEvent]); // event
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]); // reconfirmSignup signup
      // ensureRosterAssignment: no existing roster assignment
      mockDb.limit.mockResolvedValueOnce([]);
      // ensureRosterAssignment: current assignments (empty — no one slotted)
      mockDb.limit.mockResolvedValueOnce([]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      // Should have called insert for roster assignment
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 42,
          signupId: mockSignup.id,
          role: 'tank',
          position: 1,
          isOverride: 0,
        }),
      );
    });

    it('skips roster creation when assignment already exists', async () => {
      mockDb.limit.mockResolvedValueOnce([mmoEvent]); // event
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]); // reconfirmSignup signup
      // ensureRosterAssignment: existing roster assignment found
      mockDb.limit.mockResolvedValueOnce([
        { signupId: mockSignup.id, eventId: 42, role: 'tank', position: 1 },
      ]);

      const insertSpy = jest.spyOn(mockDb, 'insert');
      const callCountBefore = insertSpy.mock.calls.length;

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      // insert should not have been called again (only existing calls from update chain)
      expect(insertSpy.mock.calls.length).toBe(callCountBefore);
    });

    it('assigns to second preferred role when first is full', async () => {
      mockDb.limit.mockResolvedValueOnce([mmoEvent]); // event
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]); // linked user
      mockDb.limit.mockResolvedValueOnce([mockSignup]); // reconfirmSignup signup
      // ensureRosterAssignment: no existing roster assignment
      mockDb.limit.mockResolvedValueOnce([]);
      // ensureRosterAssignment: current assignments — both tank slots taken
      mockDb.limit.mockResolvedValueOnce([
        { role: 'tank', position: 1 },
        { role: 'tank', position: 2 },
      ]);

      const interaction = makeSelectMenuInteraction(
        `${RESCHEDULE_BUTTON_IDS.ROLE_SELECT}:42`,
        ['tank', 'healer'],
      );
      await listener['handleRoleSelect'](interaction, 42);

      // Should fall back to healer since tank is full
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'healer',
          position: 1,
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

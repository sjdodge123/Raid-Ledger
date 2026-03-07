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

let testModule: TestingModule;
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

function createRescheduleMocks() {
  mockDb = createDrizzleMock();
  mockClientService = { getClient: jest.fn().mockReturnValue(null) };
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
  mockEmbedSyncQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  mockEmojiService = {
    getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
    getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
  };
}

function buildRescheduleProviders() {
  return [
    RescheduleResponseListener,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    { provide: DiscordBotClientService, useValue: mockClientService },
    { provide: SignupsService, useValue: mockSignupsService },
    { provide: CharactersService, useValue: mockCharactersService },
    { provide: EmbedSyncQueueService, useValue: mockEmbedSyncQueue },
    { provide: DiscordEmojiService, useValue: mockEmojiService },
  ];
}

async function setupRescheduleModule() {
  createRescheduleMocks();
  testModule = await Test.createTestingModule({
    providers: buildRescheduleProviders(),
  }).compile();
  const instance: unknown = testModule.get(RescheduleResponseListener);
  listener = instance as TestableRescheduleResponseListener;
}

describe('RescheduleResponseListener — confirm', () => {
  beforeEach(async () => {
    await setupRescheduleModule();
  });

  afterEach(async () => {
    await testModule.close();
    jest.clearAllMocks();
  });

  describe('onBotConnected', () => {
    botConnectionTests();
  });

  describe('handleButtonInteraction — routing', () => {
    buttonRoutingTests();
  });

  describe('handleConfirm — edge cases', () => {
    confirmEdgeCaseTests();
  });

  describe('handleUnlinkedConfirm', () => {
    unlinkedConfirmTests();
  });

  describe('handleLinkedConfirm', () => {
    linkedConfirmTests();
  });
});

function botConnectionTests() {
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
    expect(() => listener.onBotConnected()).not.toThrow();
  });

  it('removes previous handler on reconnect', () => {
    const mockClient = { on: jest.fn(), removeListener: jest.fn() };
    mockClientService.getClient.mockReturnValue(mockClient);
    listener.onBotConnected();
    listener.onBotConnected();
    expect(mockClient.removeListener).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
  });
}

function buttonRoutingTests() {
  it('ignores interactions with wrong custom ID format', async () => {
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
    mockDb.limit.mockResolvedValueOnce([mockEvent]);
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
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
}

function confirmEdgeCaseTests() {
  it('replies "Event not found." when event does not exist', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleConfirm'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Event not found.',
    });
  });

  it('replies "cancelled" for cancelled events', async () => {
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

  it('replies "not signed up" when user has no signup', async () => {
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
}

function unlinkedConfirmTests() {
  it('re-confirms immediately for non-MMO events', async () => {
    mockDb.limit.mockResolvedValueOnce([mockEvent]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([mockSignup]);
    mockDb.limit.mockResolvedValueOnce([]);
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
    const mmoEvent = { ...mockEvent, gameId: 10, slotConfig: { type: 'mmo' } };
    mockDb.limit.mockResolvedValueOnce([mmoEvent]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    mockDb.limit.mockResolvedValueOnce([]);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.CONFIRM}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: expect.any(Array) }),
    );
  });
}

function linkedConfirmNoGameTest() {
  const linkedUser = { id: 5 };

  it('re-confirms immediately when no game is attached', async () => {
    mockDb.limit.mockResolvedValueOnce([mockEvent]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    mockDb.limit.mockResolvedValueOnce([linkedUser]);
    mockDb.limit.mockResolvedValueOnce([mockSignup]);
    mockDb.limit.mockResolvedValueOnce([]);
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
}

function linkedConfirmAutoSelectTest() {
  const linkedUser = { id: 5 };
  const character = { id: 'char-1', name: 'Arthas', isMain: true };

  it('auto-selects single character for non-MMO event', async () => {
    const eventWithGame = { ...mockEvent, gameId: 5, slotConfig: null };
    mockDb.limit.mockResolvedValueOnce([eventWithGame]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    mockDb.limit.mockResolvedValueOnce([linkedUser]);
    mockDb.limit.mockResolvedValueOnce([{ id: 5, name: 'WoW' }]);
    mockCharactersService.findAllForUser.mockResolvedValue({
      data: [character],
    });
    mockDb.limit.mockResolvedValueOnce([mockSignup]);
    mockDb.limit.mockResolvedValueOnce([]);
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
}

function linkedConfirmMultiCharTest() {
  const linkedUser = { id: 5 };

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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Pick a character'),
        components: expect.any(Array),
      }),
    );
  });
}

function linkedConfirmMmoTests() {
  const linkedUser = { id: 5 };

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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('role'),
        components: expect.any(Array),
      }),
    );
  });
}

function linkedConfirmTests() {
  linkedConfirmNoGameTest();
  linkedConfirmAutoSelectTest();
  linkedConfirmMultiCharTest();
  linkedConfirmMmoTests();
}

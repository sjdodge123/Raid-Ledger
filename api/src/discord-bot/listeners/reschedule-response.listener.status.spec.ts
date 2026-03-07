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
let mockSignupsService: {
  findByDiscordUser: jest.Mock;
  confirmSignup: jest.Mock;
  updateStatus: jest.Mock;
};
let mockEmbedSyncQueue: { enqueue: jest.Mock };

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

async function setupStatusModule() {
  mockDb = createDrizzleMock();
  mockSignupsService = {
    findByDiscordUser: jest.fn().mockResolvedValue(null),
    confirmSignup: jest.fn().mockResolvedValue({ id: 101 }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  mockEmbedSyncQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };

  testModule = await Test.createTestingModule({
    providers: [
      RescheduleResponseListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: { getClient: jest.fn().mockReturnValue(null) },
      },
      { provide: SignupsService, useValue: mockSignupsService },
      {
        provide: CharactersService,
        useValue: {
          findAllForUser: jest
            .fn()
            .mockResolvedValue({ data: [], meta: { total: 0 } }),
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'char-1', name: 'Arthas' }),
        },
      },
      { provide: EmbedSyncQueueService, useValue: mockEmbedSyncQueue },
      {
        provide: DiscordEmojiService,
        useValue: {
          getClassEmojiComponent: jest.fn().mockReturnValue(undefined),
          getRoleEmojiComponent: jest.fn().mockReturnValue(undefined),
        },
      },
    ],
  }).compile();

  const instance: unknown = testModule.get(RescheduleResponseListener);
  listener = instance as TestableRescheduleResponseListener;
}

describe('RescheduleResponseListener — status', () => {
  beforeEach(async () => {
    await setupStatusModule();
  });

  afterEach(async () => {
    await testModule.close();
    jest.clearAllMocks();
  });

  describe('handleTentative', () => {
    tentativeSuccessTests();
    tentativeEdgeCaseTests();
  });

  describe('handleDecline', () => {
    declineSuccessTests();
    declineEdgeCaseTests();
  });
});

function setupTentativeMocks() {
  mockDb.limit.mockResolvedValueOnce([mockEvent]);
  mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
  mockDb.limit.mockResolvedValueOnce([]);
  mockDb.limit.mockResolvedValueOnce([mockSignup]);
  mockDb.limit.mockResolvedValueOnce([]);
}

function tentativeSuccessTests() {
  it('sets signup status to tentative for unlinked user', async () => {
    setupTentativeMocks();
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'tentative', roachedOutAt: null }),
    );
  });

  it('replies with tentative confirmation message', async () => {
    setupTentativeMocks();
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('tentative'),
      }),
    );
  });

  it('enqueues embed sync after marking tentative', async () => {
    setupTentativeMocks();
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(mockEmbedSyncQueue.enqueue).toHaveBeenCalledWith(
      42,
      'reschedule-tentative',
    );
  });
}

function tentativeEdgeCaseTests() {
  it('replies "Event not found." when event does not exist', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleTentative'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Event not found.',
    });
  });

  it('replies "cancelled" for cancelled events', async () => {
    mockDb.limit.mockResolvedValueOnce([mockCancelledEvent]);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleTentative'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'This event has been cancelled.',
    });
  });

  it('replies "not signed up" when user has no signup', async () => {
    mockDb.limit.mockResolvedValueOnce([mockEvent]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(null);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.TENTATIVE}:42`,
    );
    await listener['handleTentative'](interaction, 42);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
    });
  });
}

function declineSuccessTests() {
  it('sets status to declined and deletes roster assignment', async () => {
    mockDb.limit.mockResolvedValueOnce([mockEvent]);
    mockSignupsService.findByDiscordUser.mockResolvedValue(mockSignup);
    const interaction = makeButtonInteraction(
      `${RESCHEDULE_BUTTON_IDS.DECLINE}:42`,
    );
    await listener['handleButtonInteraction'](interaction);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'declined' }),
    );
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('replies with "No worries!" message', async () => {
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
}

function declineEdgeCaseTests() {
  it('replies "Event not found." when event does not exist', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
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

  it('replies "cancelled" for cancelled events', async () => {
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

  it('replies "not signed up" when user has no signup', async () => {
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
}

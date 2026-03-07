import { Test, TestingModule } from '@nestjs/testing';
import { DiscordEventListener } from './event.listener';
import type { EventPayload } from './event.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

let testModule: TestingModule;
let listener: DiscordEventListener;
let clientService: jest.Mocked<DiscordBotClientService>;
let embedFactory: jest.Mocked<DiscordEmbedFactory>;
let embedPoster: jest.Mocked<EmbedPosterService>;
let mockDb: {
  insert: jest.Mock;
  select: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};
const originalClientUrl = process.env.CLIENT_URL;

// Use a future date so lead-time gating allows posting
const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const futureEndDate = new Date(futureDate.getTime() + 3 * 60 * 60 * 1000);

const mockPayload: EventPayload = {
  eventId: 42,
  event: {
    id: 42,
    title: 'Test Raid',
    startTime: futureDate.toISOString(),
    endTime: futureEndDate.toISOString(),
    signupCount: 5,
    maxAttendees: 20,
    game: { name: 'WoW', coverUrl: 'https://example.com/art.jpg' },
  },
  gameId: 101,
};

const mockEmbed = new EmbedBuilder().setTitle('Test');
const mockRow = new ActionRowBuilder<ButtonBuilder>();

function createChainMock(resolvedValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(resolvedValue);
  chain.set = jest.fn().mockReturnValue(chain);
  chain.values = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(resolvedValue);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resolvedValue).then(resolve, reject);
  return chain;
}

function buildServiceProviders() {
  return [
    {
      provide: EmbedPosterService,
      useValue: {
        postEmbed: jest.fn().mockResolvedValue(true),
        enrichWithLiveRoster: jest
          .fn()
          .mockImplementation((_id: number, event: unknown) =>
            Promise.resolve(event),
          ),
      },
    },
    {
      provide: ChannelResolverService,
      useValue: {
        resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
      },
    },
    {
      provide: SettingsService,
      useValue: {
        getBranding: jest.fn().mockResolvedValue({
          communityName: 'Test Guild',
          communityLogoPath: null,
          communityAccentColor: null,
        }),
        getClientUrl: jest.fn().mockResolvedValue(null),
        getDefaultTimezone: jest.fn().mockResolvedValue(null),
      },
    },
    {
      provide: ScheduledEventService,
      useValue: {
        createScheduledEvent: jest.fn().mockResolvedValue(undefined),
        updateScheduledEvent: jest.fn().mockResolvedValue(undefined),
        deleteScheduledEvent: jest.fn().mockResolvedValue(undefined),
        updateDescription: jest.fn().mockResolvedValue(undefined),
      },
    },
  ];
}

function buildEventListenerProviders() {
  return [
    DiscordEventListener,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    {
      provide: DiscordBotClientService,
      useValue: {
        isConnected: jest.fn().mockReturnValue(true),
        getGuildId: jest.fn().mockReturnValue('guild-123'),
        sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
        editEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
        deleteMessage: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: DiscordEmbedFactory,
      useValue: {
        buildEventEmbed: jest
          .fn()
          .mockReturnValue({ embed: mockEmbed, row: mockRow }),
        buildEventCancelled: jest.fn().mockReturnValue({ embed: mockEmbed }),
      },
    },
    ...buildServiceProviders(),
  ];
}

async function setupEventListenerModule() {
  delete process.env.CLIENT_URL;

  mockDb = {
    insert: jest.fn().mockReturnValue(createChainMock()),
    select: jest.fn().mockReturnValue(createChainMock()),
    update: jest.fn().mockReturnValue(createChainMock()),
    delete: jest.fn().mockReturnValue(createChainMock()),
  };

  testModule = await Test.createTestingModule({
    providers: buildEventListenerProviders(),
  }).compile();

  listener = testModule.get(DiscordEventListener);
  clientService = testModule.get(DiscordBotClientService);
  embedFactory = testModule.get(DiscordEmbedFactory);
  embedPoster = testModule.get(EmbedPosterService);
}

function createSelectChainWithRecord(record: object) {
  const selectChain: Record<string, unknown> = {};
  selectChain.from = jest.fn().mockReturnValue(selectChain);
  selectChain.where = jest.fn().mockReturnValue(selectChain);
  selectChain.then = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void,
  ) => Promise.resolve([record]).then(resolve, reject);
  return selectChain;
}

function createUpdateChain() {
  const updateChain: Record<string, jest.Mock> = {};
  updateChain.set = jest.fn().mockReturnValue(updateChain);
  updateChain.where = jest.fn().mockResolvedValue(undefined);
  return updateChain;
}

function createDeleteChain() {
  const deleteChain: Record<string, jest.Mock> = {};
  deleteChain.where = jest.fn().mockResolvedValue(undefined);
  return deleteChain;
}

const mockRecord = {
  id: 'record-uuid',
  eventId: 42,
  guildId: 'guild-123',
  channelId: 'channel-789',
  messageId: 'msg-456',
  embedState: EMBED_STATES.POSTED,
};

describe('DiscordEventListener', () => {
  beforeEach(async () => {
    await setupEventListenerModule();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await testModule.close();
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('handleEventCreated', () => {
    eventCreatedTests();
  });

  describe('handleEventUpdated', () => {
    eventUpdatedTests();
  });

  describe('handleEventCancelled', () => {
    eventCancelledTests();
  });

  describe('handleEventDeleted', () => {
    eventDeletedTests();
  });

  describe('updateEmbedState', () => {
    updateEmbedStateTests();
  });
});

function eventCreatedTests() {
  it('should delegate to EmbedPosterService for events within lead-time window', async () => {
    await listener.handleEventCreated(mockPayload);
    expect(embedPoster.postEmbed).toHaveBeenCalledWith(
      42,
      mockPayload.event,
      101,
      undefined,
      undefined,
    );
  });

  it('should skip posting when bot is not connected', async () => {
    clientService.isConnected.mockReturnValue(false);
    await listener.handleEventCreated(mockPayload);
    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
  });

  it('should defer to scheduler when event is outside lead-time window', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const farPayload: EventPayload = {
      ...mockPayload,
      event: {
        ...mockPayload.event,
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      },
    };
    await listener.handleEventCreated(farPayload);
    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
  });

  it('should defer recurring series events outside lead-time window', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const recurringPayload: EventPayload = {
      ...mockPayload,
      event: {
        ...mockPayload.event,
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      },
      recurrenceRule: { frequency: 'weekly' },
    };
    await listener.handleEventCreated(recurringPayload);
    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
  });
}

function eventUpdatedTests() {
  it('should skip when bot is not connected', async () => {
    clientService.isConnected.mockReturnValue(false);
    await listener.handleEventUpdated(mockPayload);
    expect(clientService.editEmbed).not.toHaveBeenCalled();
  });

  it('should skip when no message record exists and event is outside lead time', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const farPayload: EventPayload = {
      ...mockPayload,
      event: { ...mockPayload.event, startTime: farFuture.toISOString() },
    };
    await listener.handleEventUpdated(farPayload);
    expect(clientService.editEmbed).not.toHaveBeenCalled();
    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
  });

  it('should post embed when no message exists but rescheduled into lead-time window', async () => {
    await listener.handleEventUpdated(mockPayload);
    expect(embedPoster.postEmbed).toHaveBeenCalledWith(
      42,
      mockPayload.event,
      101,
      undefined,
      undefined,
    );
  });

  it('should edit the embed when a message record exists', async () => {
    mockDb.select.mockReturnValue(createSelectChainWithRecord(mockRecord));
    mockDb.update.mockReturnValue(createUpdateChain());

    await listener.handleEventUpdated(mockPayload);

    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      mockPayload.event,
      { communityName: 'Test Guild', clientUrl: null, timezone: null },
      { state: EMBED_STATES.POSTED },
    );
    expect(clientService.editEmbed).toHaveBeenCalledWith(
      'channel-789',
      'msg-456',
      mockEmbed,
      mockRow,
    );
  });
}

function eventCancelledTests() {
  it('should edit embed to cancelled state', async () => {
    mockDb.select.mockReturnValue(createSelectChainWithRecord(mockRecord));
    mockDb.update.mockReturnValue(createUpdateChain());

    await listener.handleEventCancelled(mockPayload);

    expect(embedFactory.buildEventCancelled).toHaveBeenCalledWith(
      mockPayload.event,
      { communityName: 'Test Guild', clientUrl: null, timezone: null },
    );
    expect(clientService.editEmbed).toHaveBeenCalledWith(
      'channel-789',
      'msg-456',
      mockEmbed,
    );
  });
}

function eventDeletedTests() {
  it('should delete the Discord message', async () => {
    mockDb.select.mockReturnValue(createSelectChainWithRecord(mockRecord));
    mockDb.delete.mockReturnValue(createDeleteChain());

    await listener.handleEventDeleted({ eventId: 42 });

    expect(clientService.deleteMessage).toHaveBeenCalledWith(
      'channel-789',
      'msg-456',
    );
  });

  it('should skip when no message record exists', async () => {
    await listener.handleEventDeleted({ eventId: 42 });
    expect(clientService.deleteMessage).not.toHaveBeenCalled();
  });

  it('should handle delete errors gracefully', async () => {
    mockDb.select.mockReturnValue(createSelectChainWithRecord(mockRecord));
    mockDb.delete.mockReturnValue(createDeleteChain());

    clientService.deleteMessage.mockRejectedValue(
      new Error('Message not found'),
    );

    await expect(
      listener.handleEventDeleted({ eventId: 42 }),
    ).resolves.not.toThrow();
  });
}

function updateEmbedStateTests() {
  it('should update embed state and re-render', async () => {
    mockDb.select.mockReturnValue(createSelectChainWithRecord(mockRecord));
    mockDb.update.mockReturnValue(createUpdateChain());

    await listener.updateEmbedState(
      42,
      EMBED_STATES.IMMINENT,
      mockPayload.event,
    );

    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      mockPayload.event,
      { communityName: 'Test Guild', clientUrl: null, timezone: null },
      { state: EMBED_STATES.IMMINENT },
    );
    expect(clientService.editEmbed).toHaveBeenCalled();
  });
}

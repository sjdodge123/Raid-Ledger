/**
 * ROK-716: Tests for voice channel resolution during scheduled event updates.
 * When `/bind event channel:` sets notificationChannelOverride to a text channel,
 * the scheduled event should fall back to the channel resolver for voice channel.
 * When the override IS a voice channel, it should be used directly.
 */
import { ChannelType } from 'discord.js';
import {
  setupScheduledEventTestModule,
  baseEventData,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

/** Create a mock channel object for guild.channels.cache. */
function mockChannel(type: ChannelType) {
  return {
    type,
    isVoiceBased: () =>
      type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice,
  };
}

/** Add a channels.cache mock to the guild. */
function addChannelCache(
  mockGuild: ScheduledEventMocks['mockGuild'],
  channels: Map<string, ReturnType<typeof mockChannel>>,
): void {
  (mockGuild as Record<string, unknown>).channels = {
    cache: { get: (id: string) => channels.get(id) },
  };
}

describe('updateScheduledEvent — voice channel resolution (ROK-716)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('uses notificationChannelOverride when it is a voice channel', async () => {
    const channels = new Map([
      ['voice-override-id', mockChannel(ChannelType.GuildVoice)],
    ]);
    addChannelCache(mocks.mockGuild, channels);

    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        notificationChannelOverride: 'voice-override-id',
        recurrenceGroupId: null,
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-override-id' }),
    );
    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('falls back to channel resolver when override is a text channel', async () => {
    const channels = new Map([
      ['text-channel-id', mockChannel(ChannelType.GuildText)],
    ]);
    addChannelCache(mocks.mockGuild, channels);

    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        notificationChannelOverride: 'text-channel-id',
        recurrenceGroupId: 'rec-group-1',
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(1, 'rec-group-1');
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-channel-123' }),
    );
  });

  it('uses override when channel is not in guild cache (uncached voice channel)', async () => {
    const channels = new Map<string, ReturnType<typeof mockChannel>>();
    addChannelCache(mocks.mockGuild, channels);

    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        notificationChannelOverride: 'uncached-channel-id',
        recurrenceGroupId: null,
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'uncached-channel-id' }),
    );
  });

  it('uses channel resolver when no override is set', async () => {
    addChannelCache(mocks.mockGuild, new Map());

    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        notificationChannelOverride: null,
        recurrenceGroupId: 'rec-group-1',
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);

    await mocks.service.updateScheduledEvent(42, baseEventData, 5, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(5, 'rec-group-1');
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-channel-123' }),
    );
  });

  it('uses stage voice channel override directly', async () => {
    const channels = new Map([
      ['stage-channel-id', mockChannel(ChannelType.GuildStageVoice)],
    ]);
    addChannelCache(mocks.mockGuild, channels);

    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        notificationChannelOverride: 'stage-channel-id',
        recurrenceGroupId: null,
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'stage-channel-id' }),
    );
  });
});

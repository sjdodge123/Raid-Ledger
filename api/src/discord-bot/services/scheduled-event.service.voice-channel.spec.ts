/**
 * ROK-716 / ROK-1389: voice channel resolution during scheduled event updates.
 *
 * The voice-vs-text override guard moved into
 * ChannelResolverService.resolveVoiceChannelHonoringOverride (pinned by
 * channel-resolver.service.spec.ts — voice wins / cached text falls through /
 * uncached optimistic). resolveVoiceForEdit now delegates to it, so these tests
 * verify updateScheduledEvent threads the event's override + game + recurrence
 * group through that single entry and applies whatever channel it returns to the
 * Discord SE edit.
 */
import {
  setupScheduledEventTestModule,
  baseEventData,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

describe('updateScheduledEvent — voice channel resolution (ROK-716, ROK-1389)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('threads a voice-channel override through the shared resolver and applies it', async () => {
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      'voice-override-id',
    );
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([
        {
          discordScheduledEventId: 'discord-se-id-1',
          notificationChannelOverride: 'voice-override-id',
          recurrenceGroupId: null,
        },
      ]),
    );

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelHonoringOverride,
    ).toHaveBeenCalledWith(1, null, undefined, 'voice-override-id');
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-override-id' }),
    );
  });

  it('uses the resolver result (not the override) when the override is a text channel', async () => {
    // The resolver internally drops a text override and returns the tiered voice
    // channel; the SE edit must use that, never the text override.
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      'voice-channel-123',
    );
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([
        {
          discordScheduledEventId: 'discord-se-id-1',
          notificationChannelOverride: 'text-channel-id',
          recurrenceGroupId: 'rec-group-1',
        },
      ]),
    );

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelHonoringOverride,
    ).toHaveBeenCalledWith(1, 'rec-group-1', undefined, 'text-channel-id');
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-channel-123' }),
    );
  });

  it('threads an uncached override through and applies the resolver-returned channel', async () => {
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      'uncached-channel-id',
    );
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([
        {
          discordScheduledEventId: 'discord-se-id-1',
          notificationChannelOverride: 'uncached-channel-id',
          recurrenceGroupId: null,
        },
      ]),
    );

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelHonoringOverride,
    ).toHaveBeenCalledWith(1, null, undefined, 'uncached-channel-id');
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'uncached-channel-id' }),
    );
  });

  it('threads a null override through the resolver when none is set', async () => {
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      'voice-channel-123',
    );
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([
        {
          discordScheduledEventId: 'discord-se-id-1',
          notificationChannelOverride: null,
          recurrenceGroupId: 'rec-group-1',
        },
      ]),
    );

    await mocks.service.updateScheduledEvent(42, baseEventData, 5, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelHonoringOverride,
    ).toHaveBeenCalledWith(5, 'rec-group-1', undefined, null);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ channel: 'voice-channel-123' }),
    );
  });
});

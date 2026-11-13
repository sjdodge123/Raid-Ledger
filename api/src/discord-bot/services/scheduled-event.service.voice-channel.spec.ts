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
import { GuildScheduledEventEntityType } from 'discord.js';
import { buildEphemeralChannelName } from './scheduled-event.helpers';
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

/**
 * Planned temporary voice channel (operator ruling 2026-11-13): while the
 * ephemeral channel is planned the SE is an External event at the planned
 * channel's name; once the channel exists the repoint edit makes it Voice.
 */
describe('Scheduled Event while a temporary voice channel is planned', () => {
  let mocks: ScheduledEventMocks;
  const plannedName = buildEphemeralChannelName(baseEventData);

  /** One row serves every select (SE id, live state, planned-voice read). */
  function eventRow(overrides: Record<string, unknown> = {}) {
    return {
      discordScheduledEventId: 'discord-se-id-1',
      notificationChannelOverride: null,
      recurrenceGroupId: null,
      ephemeralVoiceEnabled: true,
      ephemeralVoiceChannelId: null,
      cancelledAt: null,
      reschedulingPollId: null,
      startIso: baseEventData.startTime,
      endIso: baseEventData.endTime,
      ...overrides,
    };
  }

  function useRow(overrides: Record<string, unknown> = {}) {
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([eventRow(overrides)]),
    );
  }

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
    mocks.settingsService.getEphemeralVoiceEnabled.mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates the SE as External at the planned channel name, not the default channel', async () => {
    useRow({ discordScheduledEventId: null });

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);

    const create = mocks.mockGuild.scheduledEvents.create;
    expect(create).toHaveBeenCalledTimes(1);
    const opts = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: plannedName },
    });
    expect(opts).not.toHaveProperty('channel');
  });

  it('still creates the planned External SE when no default voice channel exists', async () => {
    useRow({ discordScheduledEventId: null });
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      null,
    );

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.External,
      }),
    );
  });

  it('creates a Voice SE in the default channel when the gate is off (unchanged)', async () => {
    mocks.settingsService.getEphemeralVoiceEnabled.mockResolvedValue(false);
    useRow({ discordScheduledEventId: null });

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.Voice,
        channel: 'voice-channel-123',
      }),
    );
  });

  it('keeps the SE External on an edit while planned (never re-pointed to the default channel)', async () => {
    useRow();

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.External,
        channel: null,
        entityMetadata: { location: plannedName },
      }),
    );
  });

  it('turns the SE into Voice in the live channel once the temporary channel exists', async () => {
    useRow({ ephemeralVoiceChannelId: 'eph-live-1' });
    mocks.channelResolver.resolveVoiceChannelHonoringOverride.mockResolvedValue(
      'eph-live-1',
    );

    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(
      mocks.channelResolver.resolveVoiceChannelHonoringOverride,
    ).toHaveBeenCalledWith(1, null, 'eph-live-1', null);
    const opts = mocks.mockGuild.scheduledEvents.edit.mock.calls[0]?.[1];
    expect(opts).toMatchObject({
      entityType: GuildScheduledEventEntityType.Voice,
      channel: 'eph-live-1',
    });
    expect(opts).not.toHaveProperty('entityMetadata');
  });

  it('turns a planned SE into Voice in the default channel once the event has started without a channel', async () => {
    const started = new Date(Date.now() - 60_000).toISOString();
    useRow();

    await mocks.service.updateScheduledEvent(
      42,
      { ...baseEventData, startTime: started },
      1,
      false,
    );

    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.Voice,
        channel: 'voice-channel-123',
      }),
    );
  });
});

/**
 * Codex r1 (2026-11-13): the planned decision must agree with the live voice
 * resolution — a voice override beats the temporary channel, and the planned
 * name must match the one EphemeralVoiceService gives the real channel.
 */
describe('planned SE — voice override and reconciliation game name', () => {
  let mocks: ScheduledEventMocks;

  function useRow(overrides: Record<string, unknown>) {
    const row = {
      discordScheduledEventId: null,
      notificationChannelOverride: null,
      recurrenceGroupId: null,
      ephemeralVoiceEnabled: true,
      ephemeralVoiceChannelId: null,
      cancelledAt: null,
      reschedulingPollId: null,
      gameId: null,
      startIso: baseEventData.startTime,
      endIso: baseEventData.endTime,
      ...overrides,
    };
    mocks.mockDb.select.mockReturnValue(mocks.createSelectChain([row]));
  }

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
    mocks.settingsService.getEphemeralVoiceEnabled.mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a Voice SE in a voice override, never External at the planned name', async () => {
    useRow({ notificationChannelOverride: 'vc-override' });
    await mocks.service.createScheduledEvent(
      42,
      baseEventData,
      1,
      false,
      'vc-override',
    );
    expect(mocks.channelResolver.overrideIsVoiceChannel).toHaveBeenCalledWith(
      'vc-override',
    );
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.Voice,
        channel: 'vc-override',
      }),
    );
  });

  it('still plans past a TEXT override (it never wins the voice slot)', async () => {
    mocks.channelResolver.overrideIsVoiceChannel.mockReturnValue(false);
    useRow({ notificationChannelOverride: 'text-override' });
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.External,
      }),
    );
  });

  it('names a reconciliation SE (gameId, no game) after the game row', async () => {
    useRow({ gameId: 7, name: 'World of Warcraft' });
    const candidate = { ...baseEventData };
    delete candidate.game;
    await mocks.service.createScheduledEvent(42, candidate, 7, false);
    const withGame = buildEphemeralChannelName(baseEventData);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ entityMetadata: { location: withGame } }),
    );
  });
});

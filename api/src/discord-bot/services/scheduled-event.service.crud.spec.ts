import {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
} from 'discord.js';
import {
  setupScheduledEventTestModule,
  makeDiscordApiError,
  baseEventData,
  PAST,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

describe('createScheduledEvent — happy path & skip conditions', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a Discord Scheduled Event for a normal (non ad-hoc) event', async () => {
    const selectChain = mocks.createSelectChain();
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Raid Night',
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: 'voice-channel-123',
      }),
    );
    expect(mocks.mockDb.update).toHaveBeenCalled();
  });

  it('skips when isAdHoc is true (AC-2)', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, 1, true);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('skips when start time is in the past', async () => {
    const pastData = { ...baseEventData, startTime: PAST.toISOString() };
    await mocks.service.createScheduledEvent(42, pastData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('skips when no guild is available', async () => {
    mocks.clientService.getGuild.mockReturnValue(null);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('skips when no voice channel is resolved (AC-10)', async () => {
    mocks.channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      null,
    );
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });
});

describe('createScheduledEvent — DB persistence & edge cases', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('stores the Discord Scheduled Event ID in the DB after creation', async () => {
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: 'discord-se-id-1',
    });
  });

  it('does not throw when Discord API returns an error (AC-13)', async () => {
    mocks.mockGuild.scheduledEvents.create.mockRejectedValue(
      new Error('Discord API is down'),
    );
    await expect(
      mocks.service.createScheduledEvent(42, baseEventData, 1, false),
    ).resolves.not.toThrow();
  });

  it('passes scheduledEndTime from eventData.endTime', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    const call = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      scheduledEndTime: Date;
      scheduledStartTime: Date;
    };
    expect(call.scheduledEndTime).toEqual(new Date(baseEventData.endTime));
    expect(call.scheduledStartTime).toEqual(new Date(baseEventData.startTime));
  });

  it('uses gameId to resolve the voice channel', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, 99, false);
    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(99, undefined);
  });

  it('handles null gameId gracefully', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, null, false);
    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(null, undefined);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });

  it('uses voiceChannelOverride instead of resolver when provided (ROK-599)', async () => {
    await mocks.service.createScheduledEvent(
      42,
      baseEventData,
      99,
      false,
      'override-vc-456',
    );
    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'override-vc-456' }),
    );
  });

  it('skips when isAdHoc is undefined (treated as falsy — allows creation)', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, 1, undefined);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });
});

describe('updateScheduledEvent', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('updates title, description, and time when a scheduled event exists (AC-3/AC-4)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({
        name: 'Raid Night',
        scheduledStartTime: new Date(baseEventData.startTime),
        scheduledEndTime: new Date(baseEventData.endTime),
      }),
    );
  });

  it('creates a new scheduled event when none exists in DB', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: null },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('creates a new scheduled event when DB row has no discordScheduledEventId', async () => {
    const selectChain = mocks.createSelectChain([{}]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });

  it('skips when isAdHoc is true', async () => {
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, true);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('recreates the scheduled event when Discord returns 10070 (AC-12)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'deleted-se-id' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });

  it('does not throw on other Discord API errors (AC-13)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      new Error('Rate limited'),
    );
    await expect(
      mocks.service.updateScheduledEvent(42, baseEventData, 1, false),
    ).resolves.not.toThrow();
  });
});

describe('deleteScheduledEvent', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('deletes the Discord Scheduled Event when one exists (AC-5/AC-6)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    await mocks.service.deleteScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(
      'discord-se-id-1',
    );
  });

  it('clears discordScheduledEventId in DB after successful delete', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    await mocks.service.deleteScheduledEvent(42);
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('skips when no discordScheduledEventId stored in DB', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: null },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.deleteScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
  });

  it('skips when DB row is empty', async () => {
    mocks.mockDb.select.mockReturnValue(mocks.createSelectChain([]));
    await mocks.service.deleteScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
  });

  it('skips silently when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await expect(mocks.service.deleteScheduledEvent(42)).resolves.not.toThrow();
  });

  it('handles 10070 gracefully — already deleted in Discord', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.delete.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await expect(mocks.service.deleteScheduledEvent(42)).resolves.not.toThrow();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('does not throw on other Discord errors (AC-13)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.delete.mockRejectedValue(
      new Error('Unexpected'),
    );
    await expect(mocks.service.deleteScheduledEvent(42)).resolves.not.toThrow();
  });
});

describe('updateDescription', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('updates only the description on the Discord Scheduled Event (AC-7)', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.updateDescription(42, baseEventData);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      expect.objectContaining({ description: expect.any(String) }),
    );
    const editArg = mocks.mockGuild.scheduledEvents.edit.mock
      .calls[0][1] as Record<string, unknown>;
    expect(editArg).not.toHaveProperty('name');
    expect(editArg).not.toHaveProperty('scheduledStartTime');
  });

  it('skips when no discordScheduledEventId in DB', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: null },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.updateDescription(42, baseEventData);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.updateDescription(42, baseEventData);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('handles 10070 by clearing the DB reference', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await expect(
      mocks.service.updateDescription(42, baseEventData),
    ).resolves.not.toThrow();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('does not throw on other Discord errors', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      new Error('Some other error'),
    );
    await expect(
      mocks.service.updateDescription(42, baseEventData),
    ).resolves.not.toThrow();
  });
});

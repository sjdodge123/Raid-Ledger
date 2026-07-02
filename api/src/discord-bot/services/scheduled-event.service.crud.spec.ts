import {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
} from 'discord.js';
import {
  setupScheduledEventTestModule,
  makeDiscordApiError,
  baseEventData,
  PAST,
  FUTURE,
  FUTURE_END,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';
import { buildScheduledEventName } from './scheduled-event.helpers';

// ROK-1350: create writes the SE under buildScheduledEventName (title + game),
// so idempotency mocks must name the pre-existing/confirmed SE the same way —
// adopt/confirm now match by the combined name, not the bare title.
const SE_NAME = buildScheduledEventName(baseEventData);

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
        // ROK-1350: SE name now incorporates the assigned game.
        name: 'Raid Night — World of Warcraft',
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

  it('re-throws when Discord API returns an error (ROK-969)', async () => {
    mocks.mockGuild.scheduledEvents.create.mockRejectedValue(
      new Error('Discord API is down'),
    );
    await expect(
      mocks.service.createScheduledEvent(42, baseEventData, 1, false),
    ).rejects.toThrow('Discord API is down');
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
    ).toHaveBeenCalledWith(99, null, null);
  });

  it('handles null gameId gracefully', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, null, false);
    expect(
      mocks.channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(null, null, null);
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

describe('createScheduledEvent — idempotency (ROK-1347)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('adopts an existing matching guild SE instead of creating a duplicate', async () => {
    // Guild already holds an SE with this event's title + start.
    const start = new Date(baseEventData.startTime).getTime();
    mocks.mockGuild.scheduledEvents.fetch.mockImplementation((seId?: string) =>
      Promise.resolve(
        seId === undefined
          ? new Map([
              [
                'pre-existing-se',
                {
                  id: 'pre-existing-se',
                  name: SE_NAME,
                  scheduledStartTimestamp: start,
                  description: 'View event: https://rl.example/events/42',
                },
              ],
            ])
          : { id: 'pre-existing-se' },
      ),
    );
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: 'pre-existing-se',
    });
  });

  it('adopts the SE id on a create timeout when Discord actually created it', async () => {
    const start = new Date(baseEventData.startTime).getTime();
    // Pre-check: empty. After the create times out, the confirmation fetch
    // returns the SE Discord created despite the slow response.
    mocks.mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(
        new Map([
          [
            'late-se',
            {
              id: 'late-se',
              name: SE_NAME,
              scheduledStartTimestamp: start,
              description: 'View event: https://rl.example/events/42',
            },
          ],
        ]),
      );
    mocks.mockGuild.scheduledEvents.create.mockRejectedValue(
      new Error('Discord API timeout: scheduledEvents.create exceeded 5000ms'),
    );
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);

    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: 'late-se',
    });
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
        // ROK-1350: SE name now incorporates the assigned game.
        name: 'Raid Night — World of Warcraft',
        scheduledStartTime: new Date(baseEventData.startTime),
        scheduledEndTime: new Date(baseEventData.endTime),
      }),
    );
  });

  it('appends the start time to the SE name when the event has an ephemeral voice channel', async () => {
    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        ephemeralVoiceChannelId: 'ephem-vc-1',
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.edit.mock.calls[0][1] as {
      name: string;
    };
    expect(editArg.name).toMatch(/^Raid Night — World of Warcraft · /);
    expect(editArg.name).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)$/);
  });

  it('keeps the clean SE name (no time suffix) for a non-ephemeral event', async () => {
    const selectChain = mocks.createSelectChain([
      {
        discordScheduledEventId: 'discord-se-id-1',
        ephemeralVoiceChannelId: null,
      },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.updateScheduledEvent(42, baseEventData, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.edit.mock.calls[0][1] as {
      name: string;
    };
    expect(editArg.name).toBe('Raid Night — World of Warcraft');
    expect(editArg.name).not.toContain('·');
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
    selectChain.limit
      .mockResolvedValueOnce([{ discordScheduledEventId: 'deleted-se-id' }])
      .mockResolvedValueOnce([{ discordScheduledEventId: null }])
      .mockResolvedValue([]);
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

// ROK-1391 — the create entry guard reads live state (reschedule flag,
// cancellation, fresh row time) once, after the id precheck. All cases below
// are RED on main (no guard yet). A single combined events-row object backs
// every mocked SELECT so getScheduledEventId / getEventLiveState /
// getRecurrenceAndEphemeral each read the fields they need.
describe('createScheduledEvent — reschedule-poll entry guard (ROK-1391)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  interface LiveRow {
    discordScheduledEventId: string | null;
    reschedulingPollId: string | null;
    cancelledAt: string | null;
    startIso: string;
    endIso: string;
    recurrenceGroupId: string | null;
    ephemeralVoiceChannelId: string | null;
  }

  function makeLive(overrides: Partial<LiveRow> = {}): LiveRow {
    return {
      discordScheduledEventId: null,
      reschedulingPollId: null,
      cancelledAt: null,
      startIso: FUTURE.toISOString(),
      endIso: FUTURE_END.toISOString(),
      recurrenceGroupId: null,
      ephemeralVoiceChannelId: null,
      ...overrides,
    };
  }

  function armDb(live: LiveRow) {
    mocks.mockDb.select.mockReturnValue(mocks.createSelectChain([live]));
    const returning = jest.fn().mockResolvedValue([{ id: 42 }]);
    const chain: Record<string, jest.Mock> = {
      set: jest.fn(),
      where: jest.fn(),
      returning,
    };
    chain.set.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    mocks.mockDb.update.mockReturnValue(chain);
  }

  it('skips the create when the event has an open reschedule poll', async () => {
    armDb(makeLive({ reschedulingPollId: 'poll-1' }));
    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('skips the create when the event is cancelled', async () => {
    armDb(makeLive({ cancelledAt: new Date().toISOString() }));
    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('substitutes the fresh row start/end when the payload time has drifted', async () => {
    const freshStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const freshEnd = new Date(freshStart.getTime() + 2 * 60 * 60 * 1000);
    armDb(
      makeLive({
        startIso: freshStart.toISOString(),
        endIso: freshEnd.toISOString(),
      }),
    );
    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledStartTime: freshStart,
        scheduledEndTime: freshEnd,
      }),
    );
  });

  it('re-applies the past-start check after substitution and skips a now-past fresh start', async () => {
    armDb(
      makeLive({
        startIso: PAST.toISOString(),
        endIso: FUTURE_END.toISOString(),
      }),
    );
    await mocks.service.createScheduledEvent(
      42,
      { ...baseEventData },
      1,
      false,
    );
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });
});

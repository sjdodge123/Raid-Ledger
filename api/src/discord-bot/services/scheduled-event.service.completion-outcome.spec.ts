import { GuildScheduledEventStatus } from 'discord.js';
import {
  setupScheduledEventTestModule,
  createSelectChainNoLimit,
  makeDiscordApiError,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

/**
 * ROK-944 diagnostics — completing a scheduled event reports what happened
 * instead of swallowing it, so the smoke trigger can name a Discord failure.
 *
 * MUTATION: make `completeScheduledEvent` return `ok: true` from its catch
 * (the old "always success" behaviour) and the 50013 / timeout cases fail on
 * `ok` and `errorCode`.
 */
describe('completeScheduledEvent — per-event outcome (ROK-944)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([{ discordScheduledEventId: 'se-1' }]),
    );
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
  });

  afterEach(() => jest.clearAllMocks());

  it('reports Scheduled -> Completed with ok:true on success', async () => {
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Scheduled,
    });
    await expect(mocks.service.completeScheduledEvent(42)).resolves.toEqual({
      eventId: 42,
      discordEventId: 'se-1',
      from: 'Scheduled',
      to: 'Completed',
      ok: true,
    });
  });

  it('reports the Discord error code and message when the edit fails', async () => {
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Scheduled,
    });
    mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      makeDiscordApiError(50013, 'Missing Permissions'),
    );
    await expect(mocks.service.completeScheduledEvent(42)).resolves.toEqual({
      eventId: 42,
      discordEventId: 'se-1',
      from: 'Scheduled',
      to: 'Scheduled',
      ok: false,
      errorCode: 50013,
      errorMessage: 'Missing Permissions',
    });
  });

  it('reports a timeout as errorCode "timeout"', async () => {
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      new Error('Discord API timeout: scheduledEvents.fetch exceeded 15000ms'),
    );
    const outcome = await mocks.service.completeScheduledEvent(42);
    expect(outcome).toMatchObject({ ok: false, errorCode: 'timeout' });
  });

  it('reports 10070 as not ok but still clears the stale DB binding', async () => {
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Guild Scheduled Event'),
    );
    const outcome = await mocks.service.completeScheduledEvent(42);
    expect(outcome).toMatchObject({ ok: false, errorCode: 10070 });
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('reports no-discord-event-id when the event has no bound SE', async () => {
    mocks.mockDb.select.mockReturnValue(
      mocks.createSelectChain([{ discordScheduledEventId: null }]),
    );
    const outcome = await mocks.service.completeScheduledEvent(42);
    expect(outcome).toEqual({
      eventId: 42,
      discordEventId: null,
      from: null,
      to: null,
      ok: false,
      errorMessage: 'no-discord-event-id',
    });
  });
});

describe('completeExpiredEventsDetailed (ROK-944)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('returns one outcome per completion candidate', async () => {
    mocks.mockDb.select
      .mockReturnValueOnce(
        createSelectChainNoLimit([{ id: 42, discordScheduledEventId: 'se-1' }]),
      )
      .mockReturnValueOnce(
        mocks.createSelectChain([{ discordScheduledEventId: 'se-1' }]),
      );
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Active,
    });
    const run = await mocks.service.completeExpiredEventsDetailed();
    expect(run).toEqual({
      outcomes: [
        {
          eventId: 42,
          discordEventId: 'se-1',
          from: 'Active',
          to: 'Completed',
          ok: true,
        },
      ],
    });
  });

  it('names why nothing ran when there are no candidates', async () => {
    mocks.mockDb.select.mockReturnValueOnce(createSelectChainNoLimit([]));
    await expect(
      mocks.service.completeExpiredEventsDetailed(),
    ).resolves.toEqual({ outcomes: [], reason: 'no-candidates' });
  });

  it('names a disconnected bot', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await expect(
      mocks.service.completeExpiredEventsDetailed(),
    ).resolves.toEqual({ outcomes: [], reason: 'bot-not-connected' });
  });
});

import { GuildScheduledEventStatus } from 'discord.js';
import type { ScheduledEventData } from './scheduled-event.helpers';
import {
  setupScheduledEventTestModule,
  createSelectChainNoLimit,
  makeDiscordApiError,
  baseEventData,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';
import { DEFAULT_CLIENT_URL } from '../../settings/settings-bot.helpers';

describe('completeScheduledEvent — status transitions', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('sets the Discord Scheduled Event status to Completed when Active', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Active,
      setStatus: jest.fn(),
    });
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      { status: GuildScheduledEventStatus.Completed },
    );
  });

  it('transitions Scheduled -> Active -> Completed when event is still Scheduled', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Scheduled,
      setStatus: jest.fn(),
    });
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      { status: GuildScheduledEventStatus.Active },
    );
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      { status: GuildScheduledEventStatus.Completed },
    );
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(2);
  });

  it('skips when event is already Completed', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Completed,
      setStatus: jest.fn(),
    });
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when event is already Canceled', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Canceled,
      setStatus: jest.fn(),
    });
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });
});

describe('completeScheduledEvent — DB cleanup & error handling', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('clears discordScheduledEventId in DB after completion', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    await mocks.service.completeScheduledEvent(42);
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('skips when no discordScheduledEventId stored in DB', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: null },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.completeScheduledEvent(42);
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });

  it('handles 10070 gracefully — already deleted in Discord', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await expect(
      mocks.service.completeScheduledEvent(42),
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
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      new Error('Unexpected'),
    );
    await expect(
      mocks.service.completeScheduledEvent(42),
    ).resolves.not.toThrow();
  });
});

describe('description building', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('includes game name, signup count, and view link in the description', async () => {
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('World of Warcraft');
    expect(editArg.description).toContain('5/25 signed up');
    expect(editArg.description).toContain('https://raidledger.app/events/42');
  });

  it('shows signup count without max when maxAttendees is null', async () => {
    const data: ScheduledEventData = {
      ...baseEventData,
      maxAttendees: null,
      signupCount: 7,
    };
    await mocks.service.createScheduledEvent(42, data, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('7 signed up');
    expect(editArg.description).not.toMatch(/\d+\/\d+/);
  });

  it('uses "Event" as game name when no game provided', async () => {
    const data: ScheduledEventData = { ...baseEventData, game: null };
    await mocks.service.createScheduledEvent(42, data, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('Event —');
  });

  it('includes view link with default URL when no explicit client URL is set', async () => {
    mocks.settingsService.getClientUrl.mockResolvedValue(DEFAULT_CLIENT_URL);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('View event');
    expect(editArg.description).toContain(`${DEFAULT_CLIENT_URL}/events/42`);
  });

  it('truncates long descriptions to 1000 characters', async () => {
    const data: ScheduledEventData = {
      ...baseEventData,
      description: 'a'.repeat(2000),
    };
    await mocks.service.createScheduledEvent(42, data, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description.length).toBeLessThanOrEqual(1000);
  });

  it('preserves header even when description is extremely long', async () => {
    const data: ScheduledEventData = {
      ...baseEventData,
      description: 'x'.repeat(2000),
    };
    await mocks.service.createScheduledEvent(42, data, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('World of Warcraft');
  });

  it('handles null/undefined description gracefully', async () => {
    const data: ScheduledEventData = { ...baseEventData, description: null };
    await mocks.service.createScheduledEvent(42, data, 1, false);
    const editArg = mocks.mockGuild.scheduledEvents.create.mock.calls[0][0] as {
      description: string;
    };
    expect(editArg.description).toContain('World of Warcraft');
  });
});

describe('startScheduledEvents — basic cases', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('starts a Discord scheduled event that is still in SCHEDULED state', async () => {
    const selectChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Scheduled,
    });
    await mocks.service.startScheduledEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith(
      'discord-se-id-1',
      { status: GuildScheduledEventStatus.Active },
    );
  });

  it('skips events already in ACTIVE state', async () => {
    const selectChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'discord-se-id-1' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'discord-se-id-1',
      status: GuildScheduledEventStatus.Active,
    });
    await mocks.service.startScheduledEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when no candidates found', async () => {
    mocks.mockDb.select.mockReturnValue(createSelectChainNoLimit([]));
    await mocks.service.startScheduledEvents();
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.startScheduledEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });

  it('skips when no guild is available', async () => {
    mocks.clientService.getGuild.mockReturnValue(null);
    await mocks.service.startScheduledEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });
});

describe('startScheduledEvents — error handling & multiple', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('clears DB reference when Discord event was manually deleted (10070)', async () => {
    const selectChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'deleted-se-id' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await mocks.service.startScheduledEvents();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: null,
    });
  });

  it('handles multiple candidates — starts only SCHEDULED ones', async () => {
    const selectChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce({
        id: 'se-1',
        status: GuildScheduledEventStatus.Scheduled,
      })
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Active,
      });
    await mocks.service.startScheduledEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(1);
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      status: GuildScheduledEventStatus.Active,
    });
  });

  it('does not throw on Discord API errors — logs and continues', async () => {
    const selectChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockGuild.scheduledEvents.fetch
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Scheduled,
      });
    await expect(mocks.service.startScheduledEvents()).resolves.not.toThrow();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-2', {
      status: GuildScheduledEventStatus.Active,
    });
  });
});

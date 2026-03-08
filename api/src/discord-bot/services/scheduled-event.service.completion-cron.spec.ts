import { GuildScheduledEventStatus } from 'discord.js';
import {
  setupScheduledEventTestModule,
  makeDiscordApiError,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

/** Build a select chain that resolves at .where() (no .limit()). */
const createSelectChainNoLimit = (rows: unknown[] = []) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
};

describe('completeExpiredEvents — normal completion', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('completes a Discord Scheduled Event that has ended', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Active,
    });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      status: GuildScheduledEventStatus.Completed,
    });
  });

  it('completes multiple expired events', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    const seIdChain1 = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain2 = mocks.createSelectChain([
      { discordScheduledEventId: 'se-2' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain1)
      .mockReturnValueOnce(seIdChain2);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce({
        id: 'se-1',
        status: GuildScheduledEventStatus.Active,
      })
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Active,
      });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(2);
  });

  it('skips when no candidates found', async () => {
    mocks.mockDb.select.mockReturnValue(createSelectChainNoLimit([]));
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });
});

describe('completeExpiredEvents — idempotent & skip conditions', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('is idempotent — already Completed events are skipped', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Completed,
    });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });

  it('skips when no guild is available', async () => {
    mocks.clientService.getGuild.mockReturnValue(null);
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });
});

describe('completeExpiredEvents — error handling', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('clears DB reference when Discord event was manually deleted (10070)', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'deleted-se-id' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'deleted-se-id' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await expect(mocks.service.completeExpiredEvents()).resolves.not.toThrow();
  });

  it('does not throw on Discord API errors', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      new Error('Rate limited'),
    );
    await expect(mocks.service.completeExpiredEvents()).resolves.not.toThrow();
  });
});

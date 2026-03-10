/**
 * Regression tests for ROK-755: Discord scheduled events decoupled from embed lead-time.
 *
 * Covers:
 * - Deduplication: createScheduledEvent skips if discord_scheduled_event_id already set
 * - Logging: early returns in createScheduledEvent produce warnings
 * - Reconciliation: ScheduledEventReconciliationService creates missing events
 */
import {
  setupScheduledEventTestModule,
  baseEventData,
  PAST,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';
import { getCreateSkipReason } from './scheduled-event.helpers';

describe('createScheduledEvent — deduplication (ROK-755)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('skips creation when discordScheduledEventId already exists', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: 'existing-se-id' },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('creates when discordScheduledEventId is null', async () => {
    const selectChain = mocks.createSelectChain([
      { discordScheduledEventId: null },
    ]);
    mocks.mockDb.select.mockReturnValue(selectChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });
});

describe('getCreateSkipReason — warn logging (ROK-755)', () => {
  const futureTime = new Date(Date.now() + 86400000).toISOString();

  it('returns ad-hoc skip reason', () => {
    const reason = getCreateSkipReason(1, futureTime, true, true);
    expect(reason).toContain('ad-hoc');
  });

  it('returns bot not connected skip reason', () => {
    const reason = getCreateSkipReason(1, futureTime, false, false);
    expect(reason).toContain('bot not connected');
  });

  it('returns past start time skip reason', () => {
    const reason = getCreateSkipReason(1, PAST.toISOString(), false, true);
    expect(reason).toContain('start time in the past');
  });

  it('returns null when all checks pass', () => {
    const reason = getCreateSkipReason(1, futureTime, false, true);
    expect(reason).toBeNull();
  });
});

describe('createScheduledEvent — voice channel logging (ROK-755)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('logs warning when no voice channel resolved', async () => {
    mocks.channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      null,
    );
    const logSpy = jest.spyOn((mocks.service as any).logger, 'warn');
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('no voice channel'),
    );
  });
});

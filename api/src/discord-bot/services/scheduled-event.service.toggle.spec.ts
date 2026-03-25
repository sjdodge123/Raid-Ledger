import {
  setupScheduledEventTestModule,
  baseEventData,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';

describe('ScheduledEventService — SE creation toggle (ROK-969)', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('skips createScheduledEvent when toggle is disabled', async () => {
    mocks.service.setScheduledEventsEnabled(false);
    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('creates normally when toggle is re-enabled', async () => {
    mocks.service.setScheduledEventsEnabled(false);
    mocks.service.setScheduledEventsEnabled(true);

    const selectChain = mocks.createSelectChain();
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });

  it('defaults to enabled (creates without explicit toggle call)', async () => {
    const selectChain = mocks.createSelectChain();
    mocks.mockDb.select.mockReturnValue(selectChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);

    await mocks.service.createScheduledEvent(42, baseEventData, 1, false);
    expect(mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
  });
});

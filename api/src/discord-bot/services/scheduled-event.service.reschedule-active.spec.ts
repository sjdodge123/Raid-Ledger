/**
 * ROK-2201: rescheduling an event whose Discord Scheduled Event is already
 * ACTIVE. Discord rejects a start-time edit on an ACTIVE SE, so the update
 * path must END the live SE and create a new one at the new start, and any
 * other rejected edit must be recreated (when safe) or logged with its code —
 * never silently dropped.
 */
import { Logger } from '@nestjs/common';
import { GuildScheduledEventStatus } from 'discord.js';
import {
  setupScheduledEventTestModule,
  makeDiscordApiError,
  baseEventData,
  FUTURE,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';
import { defined } from '../../common/testing/narrow';

const OLD_SE = 'old-se-id';
const NEW_SE = 'new-se-id';

/** Point `fetch(seId)` at an SE in `status`; no-arg fetch stays an empty Map. */
function stubSEStatus(
  mocks: ScheduledEventMocks,
  status: GuildScheduledEventStatus,
): void {
  mocks.mockGuild.scheduledEvents.fetch.mockImplementation((seId?: string) =>
    Promise.resolve(
      seId === undefined
        ? new Map()
        : { id: seId, status, channelId: 'voice-1' },
    ),
  );
}

/** Stored id on the first read, cleared on later reads (the create path). */
function stubStoredId(mocks: ScheduledEventMocks): Record<string, jest.Mock> {
  const selectChain = mocks.createSelectChain([
    { discordScheduledEventId: OLD_SE },
  ]);
  defined(selectChain.limit, 'select chain limit')
    .mockResolvedValueOnce([{ discordScheduledEventId: OLD_SE }])
    .mockResolvedValueOnce([{ discordScheduledEventId: null }])
    .mockResolvedValue([]);
  mocks.mockDb.select.mockReturnValue(selectChain);
  const updateChain = mocks.createUpdateChain();
  mocks.mockDb.update.mockReturnValue(updateChain);
  return updateChain;
}

/** The full-field edit is rejected; any later (status) edit resolves. */
function rejectFullEdit(mocks: ScheduledEventMocks, code: number): void {
  mocks.mockGuild.scheduledEvents.edit
    .mockRejectedValueOnce(makeDiscordApiError(code, 'Invalid Form Body'))
    .mockResolvedValue({ id: OLD_SE });
}

function statusEdits(mocks: ScheduledEventMocks): unknown[] {
  return mocks.mockGuild.scheduledEvents.edit.mock.calls
    .map((c: unknown[]) => c[1] as { status?: unknown })
    .filter((arg: { status?: unknown }) => arg.status !== undefined)
    .map((arg: { status?: unknown }) => arg.status);
}

interface Harness {
  mocks: ScheduledEventMocks;
  errorSpy: jest.SpyInstance;
}

/** Fresh module with a silenced, spied logger. */
async function setupHarness(): Promise<Harness> {
  const mocks = await setupScheduledEventTestModule();
  mocks.mockGuild.scheduledEvents.create.mockResolvedValue({ id: NEW_SE });
  const errorSpy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { mocks, errorSpy };
}

describe('updateScheduledEvent — ACTIVE SE moved later (ROK-2201)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(() => jest.restoreAllMocks());

  it('ends an ACTIVE SE and creates a new one at the later start', async () => {
    const updateChain = stubStoredId(h.mocks);
    stubSEStatus(h.mocks, GuildScheduledEventStatus.Active);
    rejectFullEdit(h.mocks, 50035);

    await h.mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    const { edit, create } = h.mocks.mockGuild.scheduledEvents;
    expect(edit).toHaveBeenCalledWith(OLD_SE, {
      status: GuildScheduledEventStatus.Completed,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledStartTime: FUTURE }),
    );
    expect(updateChain.set).toHaveBeenNthCalledWith(1, {
      discordScheduledEventId: null,
    });
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: NEW_SE,
    });
    const setMock = defined(updateChain.set, 'update chain set');
    const clearOrder = setMock.mock.invocationCallOrder[0] ?? Infinity;
    const createOrder = create.mock.invocationCallOrder[0] ?? -Infinity;
    expect(clearOrder).toBeLessThan(createOrder);
  });

  it('deletes the ACTIVE SE when ending it is refused, then recreates', async () => {
    const updateChain = stubStoredId(h.mocks);
    stubSEStatus(h.mocks, GuildScheduledEventStatus.Active);
    h.mocks.mockGuild.scheduledEvents.edit.mockRejectedValue(
      makeDiscordApiError(50035, 'Invalid Form Body'),
    );

    await h.mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(h.mocks.mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(
      OLD_SE,
    );
    expect(h.mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: NEW_SE,
    });
  });
});

describe('updateScheduledEvent — not-started or finished SE (ROK-2201)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(() => jest.restoreAllMocks());

  it('edits a SCHEDULED SE in place exactly as before (no fetch, no recreate)', async () => {
    stubStoredId(h.mocks);
    stubSEStatus(h.mocks, GuildScheduledEventStatus.Scheduled);

    await h.mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    const { edit, create, fetch } = h.mocks.mockGuild.scheduledEvents;
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith(
      OLD_SE,
      expect.objectContaining({ scheduledStartTime: FUTURE }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(statusEdits(h.mocks)).toEqual([]);
  });

  it('logs a rejected edit of a SCHEDULED SE with its Discord code', async () => {
    stubStoredId(h.mocks);
    stubSEStatus(h.mocks, GuildScheduledEventStatus.Scheduled);
    rejectFullEdit(h.mocks, 50013);

    await h.mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(h.mocks.mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
    expect(statusEdits(h.mocks)).toEqual([]);
    const logged = h.errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(logged).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/event 42 .*code=50013.*status=Scheduled/),
      ]),
    );
  });

  it('recreates when the rejected edit hit an SE that already ended', async () => {
    const updateChain = stubStoredId(h.mocks);
    stubSEStatus(h.mocks, GuildScheduledEventStatus.Completed);
    rejectFullEdit(h.mocks, 180000);

    await h.mocks.service.updateScheduledEvent(42, baseEventData, 1, false);

    expect(statusEdits(h.mocks)).toEqual([]);
    expect(h.mocks.mockGuild.scheduledEvents.create).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith({
      discordScheduledEventId: NEW_SE,
    });
  });
});

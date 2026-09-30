/**
 * Unit tests for runCreateEvent's fire-and-forget side effects: a failed
 * follow-up fan-out or activity-log write never fails event creation, and
 * is warned with its stack so the swallowed rejection stays traceable.
 */
import type { Logger } from '@nestjs/common';
import type { CreateEventDto } from '@raid-ledger/contract';
import { runCreateEvent } from './event-create-flow.helpers';
import { runFollowupFanout } from '../notifications/post-event-followup-fanout.helpers';
import {
  insertRecurringEvents,
  insertSingleEvent,
} from './event-create.helpers';

jest.mock('../notifications/post-event-followup-fanout.helpers', () => ({
  runFollowupFanout: jest.fn(),
}));
jest.mock('./event-create.helpers', () => ({
  insertRecurringEvents: jest.fn(),
  insertSingleEvent: jest.fn(),
  buildBaseValues: jest.fn(() => ({})),
  resolveRecurrenceGroupId: jest.fn(() => null),
}));
jest.mock('./event-response.helpers', () => ({
  buildLifecyclePayload: jest.fn(() => ({})),
}));

const fanout = jest.mocked(runFollowupFanout);
const insertSingle = jest.mocked(insertSingleEvent);
const insertRecurring = jest.mocked(insertRecurringEvents);

function makeDeps() {
  return {
    db: {} as never,
    eventEmitter: { emit: jest.fn() } as never,
    logger: {
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<Logger>,
    findByIds: jest.fn((ids: number[]) =>
      Promise.resolve(ids.map((id) => ({ id }) as never)),
    ),
    findOne: jest.fn((id: number) => Promise.resolve({ id } as never)),
    notificationService: { createMany: jest.fn() },
  };
}

const BASE_DTO = {
  title: 'Raid night',
  startTime: '2026-10-01T19:00:00.000Z',
  endTime: '2026-10-01T22:00:00.000Z',
} as CreateEventDto;

/** Let the fire-and-forget `.catch` handlers run — no timers. */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('runCreateEvent side-effect failures', () => {
  beforeEach(() => jest.clearAllMocks());

  it('warns a failed follow-up fan-out with its stack', async () => {
    const deps = makeDeps();
    const boom = new Error('fan-out exploded');
    insertSingle.mockResolvedValue({ id: 100 } as never);
    fanout.mockRejectedValue(boom);
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const dto = { ...BASE_DTO, followupForEventId: 5 } as CreateEventDto;
    await expect(runCreateEvent(deps, activityLog, 1, dto)).resolves.toEqual(
      expect.objectContaining({ id: 100 }),
    );
    await flushMicrotasks();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Follow-up fan-out failed for ended event 5',
      boom.stack,
    );
  });

  it('warns a failed recurring activity-log write with its stack', async () => {
    const deps = makeDeps();
    const boom = new Error('activity log down');
    insertRecurring.mockResolvedValue([{ id: 11 }, { id: 12 }] as never);
    const activityLog = { log: jest.fn().mockRejectedValue(boom) };
    const dto = { ...BASE_DTO, recurrence: { frequency: 'weekly' } };
    await runCreateEvent(deps, activityLog, 1, dto as CreateEventDto);
    await flushMicrotasks();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Activity log failed for event 11',
      boom.stack,
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Activity log failed for event 12',
      boom.stack,
    );
  });
});

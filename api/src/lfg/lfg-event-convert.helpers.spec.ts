/**
 * ROK-1573 — unit coverage for convert-on-create (`POST /events` + `lfgGameId`).
 *
 * The helper must never convert a group the caller is not part of (Q3), and
 * the service must never throw into event creation: the event already exists
 * by the time conversion runs.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { convertGroupToEvent } from './lfg-event-convert.helpers';
import { LfgEventConvertService } from './lfg-event-convert.service';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_EVENTS } from './lfg.constants';

const USER = 11;
const GAME = 22;
const EVENT = 33;

function asDb(mock: MockDb): LfgDb {
  return mock as unknown as LfgDb;
}

describe('convertGroupToEvent', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('returns [] and never updates when the caller is not a participant', async () => {
    db.limit.mockResolvedValueOnce([]);

    const result = await convertGroupToEvent(asDb(db), USER, GAME, EVENT);

    expect(result).toEqual([]);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('takes the group advisory lock inside a transaction', async () => {
    db.limit.mockResolvedValueOnce([]);

    await convertGroupToEvent(asDb(db), USER, GAME, EVENT);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('converts the live group to the event and returns unique member ids', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockResolvedValueOnce([
      { userId: USER },
      { userId: 44 },
      { userId: 44 },
    ]);

    const result = await convertGroupToEvent(asDb(db), USER, GAME, EVENT);

    expect(result).toEqual([USER, 44]);
    expect(db.set).toHaveBeenCalledWith({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: EVENT,
    });
  });
});

describe('LfgEventConvertService.convertForNewEvent', () => {
  let db: MockDb;
  let emit: jest.Mock;
  let service: LfgEventConvertService;

  beforeEach(() => {
    db = createDrizzleMock();
    emit = jest.fn();
    service = new LfgEventConvertService(asDb(db), {
      emit,
    } as unknown as EventEmitter2);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits group-changed (converted, eventId) when members converted', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockResolvedValueOnce([{ userId: USER }, { userId: 44 }]);

    const result = await service.convertForNewEvent(USER, GAME, EVENT);

    expect(result).toEqual([USER, 44]);
    expect(emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME,
      reason: 'converted',
      eventId: EVENT,
    });
  });

  it('does not emit when nothing converted (stale tab / double create)', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockResolvedValueOnce([]);

    const result = await service.convertForNewEvent(USER, GAME, EVENT);

    expect(result).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('warns and skips when the caller is not a participant (Q3)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    db.limit.mockResolvedValueOnce([]);

    const result = await service.convertForNewEvent(USER, GAME, EVENT);

    expect(result).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('swallows a thrown error, returns [] and logs a warning', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    db.transaction.mockRejectedValueOnce(new Error('boom'));

    const result = await service.convertForNewEvent(USER, GAME, EVENT);

    expect(result).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

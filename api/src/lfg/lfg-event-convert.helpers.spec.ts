/**
 * ROK-1573 — unit coverage for convert-on-create (`POST /events` + `lfgGameId`).
 *
 * Review P2-2: the live-intent check, the event create and the conversion are
 * serialized by the group advisory lock, so a caller whose group is gone gets a
 * 409 and NO event — never a stray one-person event.
 */
import { ConflictException, Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  createAndConvertGroup,
  LFG_GROUP_GONE_MESSAGE,
} from './lfg-event-convert.helpers';
import { LfgEventConvertService } from './lfg-event-convert.service';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_EVENTS } from './lfg.constants';

const USER = 11;
const GAME = 22;
const EVENT = { id: 33, title: 'Raid' };

function asDb(mock: MockDb): LfgDb {
  return mock as unknown as LfgDb;
}

describe('createAndConvertGroup', () => {
  let db: MockDb;
  let createEvent: jest.Mock;

  beforeEach(() => {
    db = createDrizzleMock();
    createEvent = jest.fn().mockResolvedValue(EVENT);
  });

  it('409s, creates no event and converts nothing when the caller holds no live intent', async () => {
    db.limit.mockResolvedValueOnce([]);

    const run = createAndConvertGroup(asDb(db), USER, GAME, createEvent);

    await expect(run).rejects.toBeInstanceOf(ConflictException);
    await expect(run).rejects.toThrow(LFG_GROUP_GONE_MESSAGE);
    expect(createEvent).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('takes the group advisory lock inside a transaction before the check', async () => {
    db.limit.mockResolvedValueOnce([]);

    await createAndConvertGroup(asDb(db), USER, GAME, createEvent).catch(
      () => undefined,
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(
      db.limit.mock.invocationCallOrder[0],
    );
  });

  it('creates the event, then converts the live group to it', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockResolvedValueOnce([
      { userId: USER },
      { userId: 44 },
      { userId: 44 },
    ]);

    const result = await createAndConvertGroup(
      asDb(db),
      USER,
      GAME,
      createEvent,
    );

    expect(result).toEqual({ event: EVENT, memberIds: [USER, 44] });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.invocationCallOrder[0]).toBeLessThan(
      db.update.mock.invocationCallOrder[0],
    );
    expect(db.set).toHaveBeenCalledWith({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: EVENT.id,
    });
  });
});

describe('LfgEventConvertService.createForGroup', () => {
  let db: MockDb;
  let emit: jest.Mock;
  let service: LfgEventConvertService;
  let createEvent: jest.Mock;

  beforeEach(() => {
    db = createDrizzleMock();
    emit = jest.fn();
    createEvent = jest.fn().mockResolvedValue(EVENT);
    service = new LfgEventConvertService(asDb(db), {
      emit,
    } as unknown as EventEmitter2);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits group-changed (converted, eventId) when members converted', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockResolvedValueOnce([{ userId: USER }, { userId: 44 }]);

    const result = await service.createForGroup(USER, GAME, createEvent);

    expect(result).toEqual({ event: EVENT, memberIds: [USER, 44] });
    expect(emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME,
      reason: 'converted',
      eventId: EVENT.id,
    });
  });

  it('rethrows the 409 without creating or emitting (group already scheduled)', async () => {
    db.limit.mockResolvedValueOnce([]);

    await expect(
      service.createForGroup(USER, GAME, createEvent),
    ).rejects.toMatchObject({
      status: 409,
      message: LFG_GROUP_GONE_MESSAGE,
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps a committed event as a plain event when the conversion fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    db.returning.mockRejectedValueOnce(new Error('boom'));

    const result = await service.createForGroup(USER, GAME, createEvent);

    expect(result).toEqual({ event: EVENT, memberIds: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('rethrows when the event create itself fails', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    createEvent.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      service.createForGroup(USER, GAME, createEvent),
    ).rejects.toThrow('insert failed');
    expect(emit).not.toHaveBeenCalled();
  });
});

/**
 * ROK-1728 — series signup routes. Every route requires a JWT and a
 * non-deactivated user; a non-series event is a 400 before any write; a
 * bad body is a 400 before the service touches the database.
 */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { EventsSeriesSignupController } from './events-series-signup.controller';
import { SERIES_ERRORS } from './series-signups-join.helpers';
import { SeriesSignupsService } from './series-signups.service';
import { SignupsService } from './signups.service';

const ROUTES = ['getSeriesSignup', 'joinSeries', 'leaveSeries'] as const;

const REQ: AuthenticatedRequest = {
  user: {
    id: 42,
    username: 'member',
    role: 'member',
    discordId: null,
    deactivatedAt: null,
    impersonatedBy: null,
    tokenVersion: 0,
  },
};

const ELIGIBLE_USER = { deactivatedAt: null, bannedAt: null, kickedAt: null };

const NON_SERIES_EVENT = {
  id: 7,
  recurrenceGroupId: null,
  cancelledAt: null,
  duration: [
    new Date('2030-01-01T20:00:00Z'),
    new Date('2030-01-01T23:00:00Z'),
  ],
};

function guardsOf(method: (typeof ROUTES)[number]): unknown[] {
  const handler = EventsSeriesSignupController.prototype[method];
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
  return guards;
}

describe('EventsSeriesSignupController (ROK-1728)', () => {
  let controller: EventsSeriesSignupController;
  let db: MockDb;
  const signups = { signup: jest.fn(), cancel: jest.fn() };
  const activityLog = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    const moduleRef = await Test.createTestingModule({
      controllers: [EventsSeriesSignupController],
      providers: [
        SeriesSignupsService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: SignupsService, useValue: signups },
        { provide: ActivityLogService, useValue: activityLog },
      ],
    }).compile();
    controller = moduleRef.get(EventsSeriesSignupController);
  });

  it.each(ROUTES)('%s requires a JWT and a non-deactivated user', (method) => {
    const guards = guardsOf(method);
    // `AuthGuard` memoizes per strategy, so identity comparison holds.
    expect(guards).toContain(AuthGuard('jwt'));
    expect(guards).toContain(NotDeactivatedGuard);
  });

  it('GET on a non-series event is a 400 "not part of a series"', async () => {
    db.limit.mockResolvedValueOnce([NON_SERIES_EVENT]);
    await expect(controller.getSeriesSignup(7, REQ)).rejects.toThrow(
      new BadRequestException(SERIES_ERRORS.NOT_SERIES),
    );
  });

  it('POST on a non-series event is a 400 and writes nothing', async () => {
    db.limit
      .mockResolvedValueOnce([ELIGIBLE_USER])
      .mockResolvedValueOnce([NON_SERIES_EVENT]);
    await expect(controller.joinSeries(7, REQ, {})).rejects.toThrow(
      new BadRequestException(SERIES_ERRORS.NOT_SERIES),
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(signups.signup).not.toHaveBeenCalled();
  });

  it('DELETE on a non-series event is a 400 and cancels nothing', async () => {
    db.limit.mockResolvedValueOnce([NON_SERIES_EVENT]);
    await expect(controller.leaveSeries(7, REQ)).rejects.toThrow(
      new BadRequestException(SERIES_ERRORS.NOT_SERIES),
    );
    expect(db.update).not.toHaveBeenCalled();
    expect(signups.cancel).not.toHaveBeenCalled();
  });

  it('POST with an invalid body is a 400 before any database read', async () => {
    await expect(
      controller.joinSeries(7, REQ, { characterId: 'not-a-uuid' }),
    ).rejects.toThrow(new BadRequestException('Validation failed'));
    expect(db.select).not.toHaveBeenCalled();
  });
});

import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  buildSignupDto,
  createSignupForTest,
  cancelSignupForTest,
  triggerDepartureForTest,
  setRunningLateForTest,
  RunningLateTestSchema,
} from './demo-test-signups.helpers';

type Db = PostgresJsDatabase<typeof schema>;

function mockModuleRef(overrides: Record<string, unknown>): ModuleRef {
  return {
    get: jest.fn().mockImplementation((token: unknown) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return overrides[name] ?? {};
    }),
  } as unknown as ModuleRef;
}

describe('demo-test-signups.helpers - buildSignupDto', () => {
  it('returns undefined without a dto', () => {
    expect(buildSignupDto()).toBeUndefined();
  });

  it('filters invalid roles and keeps valid ones', () => {
    const dto = buildSignupDto({
      preferredRoles: ['tank', 'bard', 'dps'],
      characterId: 'c1',
    });
    expect(dto).toEqual({
      preferredRoles: ['tank', 'dps'],
      characterId: 'c1',
    });
  });

  it('drops preferredRoles entirely when none are valid', () => {
    const dto = buildSignupDto({ preferredRoles: ['bard'] });
    expect(dto?.preferredRoles).toBeUndefined();
  });
});

describe('demo-test-signups.helpers - createSignupForTest', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('delegates to SignupsService.signup with skipEndedCheck', async () => {
    const signup = jest.fn().mockResolvedValue({ id: 42 });
    const moduleRef = mockModuleRef({ SignupsService: { signup } });

    const result = await createSignupForTest(
      moduleRef,
      db as unknown as Db,
      7,
      3,
    );

    expect(signup).toHaveBeenCalledWith(7, 3, undefined, {
      skipEndedCheck: true,
    });
    expect(result).toEqual({ id: 42 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('overrides the status in the DB for non-default statuses', async () => {
    const signup = jest.fn().mockResolvedValue({ id: 42 });
    const moduleRef = mockModuleRef({ SignupsService: { signup } });

    await createSignupForTest(moduleRef, db as unknown as Db, 7, 3, {
      status: 'tentative',
    });

    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({ status: 'tentative' });
  });
});

describe('demo-test-signups.helpers - cancel and departure', () => {
  it('cancelSignupForTest delegates to SignupsRosterService.cancel', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    const moduleRef = mockModuleRef({ SignupsRosterService: { cancel } });

    await cancelSignupForTest(moduleRef, 7, 3);

    expect(cancel).toHaveBeenCalledWith(7, 3);
  });

  it('triggerDepartureForTest enqueues with zero delay', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const moduleRef = mockModuleRef({
      DepartureGraceQueueService: { enqueue },
    });

    await triggerDepartureForTest(moduleRef, 7, 42, 'discord-1');

    expect(enqueue).toHaveBeenCalledWith(
      { eventId: 7, signupId: 42, discordUserId: 'discord-1' },
      0,
    );
  });
});

describe('demo-test-signups.helpers - setRunningLateForTest (ROK-2271)', () => {
  function lateService() {
    return {
      setRunningLate: jest.fn().mockResolvedValue(true),
      clearRunningLate: jest.fn().mockResolvedValue(false),
    };
  }

  it('marks late through RunningLateService (urgent emit path)', async () => {
    const svc = lateService();
    const moduleRef = mockModuleRef({ RunningLateService: svc });

    const res = await setRunningLateForTest(moduleRef, {
      eventId: 7,
      userId: 42,
      minutes: 15,
    });

    expect(res).toEqual({ changed: true });
    expect(svc.setRunningLate).toHaveBeenCalledWith(7, 42, 15);
    expect(svc.clearRunningLate).not.toHaveBeenCalled();
  });

  it('clears through RunningLateService when clear is true', async () => {
    const svc = lateService();
    const moduleRef = mockModuleRef({ RunningLateService: svc });

    const res = await setRunningLateForTest(moduleRef, {
      eventId: 7,
      userId: 42,
      clear: true,
    });

    expect(res).toEqual({ changed: false });
    expect(svc.clearRunningLate).toHaveBeenCalledWith(7, 42);
    expect(svc.setRunningLate).not.toHaveBeenCalled();
  });

  it('rejects a non-positive event id and out-of-range minutes', () => {
    expect(
      RunningLateTestSchema.safeParse({ eventId: 0, userId: 1 }).success,
    ).toBe(false);
    expect(
      RunningLateTestSchema.safeParse({ eventId: 1, userId: 1, minutes: 0 })
        .success,
    ).toBe(false);
  });
});

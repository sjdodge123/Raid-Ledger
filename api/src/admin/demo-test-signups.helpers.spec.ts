import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  buildSignupDto,
  createSignupForTest,
  cancelSignupForTest,
  triggerDepartureForTest,
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

describe('demo-test-signups.helpers', () => {
  describe('buildSignupDto', () => {
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

  describe('createSignupForTest', () => {
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

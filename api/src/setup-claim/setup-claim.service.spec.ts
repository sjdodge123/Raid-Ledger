/** ROK-1701: `publicStatus()` — the `/system/status` claim fields. */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { FLAVOUR_ENV } from '../common/flavour/flavour';
import type * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { encrypt } from '../settings/encryption.util';
import { ClaimLockService } from './claim-lock.service';
import { SetupClaimService } from './setup-claim.service';

const HASH = 'a'.repeat(64);
const EXP = '2026-11-02T05:00:00.000Z';

function makeService(mock: MockDb): SetupClaimService {
  const db = mock as unknown as PostgresJsDatabase<typeof schema>;
  const events = { emit: jest.fn() } as unknown as EventEmitter2;
  return new SetupClaimService(db, new ClaimLockService(), events);
}

describe('SetupClaimService.publicStatus', () => {
  const saved = {
    flavour: process.env[FLAVOUR_ENV],
    demo: process.env.DEMO_MODE,
  };
  let mock: MockDb;

  beforeEach(() => {
    mock = createDrizzleMock();
    mock.where.mockResolvedValue([
      { key: SETTING_KEYS.CLAIM_CODE_HASH, encryptedValue: encrypt(HASH) },
      { key: SETTING_KEYS.CLAIM_EXPIRES_AT, encryptedValue: encrypt(EXP) },
    ]);
  });

  afterEach(() => {
    if (saved.flavour === undefined) delete process.env[FLAVOUR_ENV];
    else process.env[FLAVOUR_ENV] = saved.flavour;
    if (saved.demo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = saved.demo;
  });

  it('NAS without DEMO_MODE answers false without touching the db', async () => {
    process.env[FLAVOUR_ENV] = 'nas';
    delete process.env.DEMO_MODE;
    await expect(makeService(mock).publicStatus()).resolves.toEqual({
      claimRequired: false,
    });
    expect(mock.select).not.toHaveBeenCalled();
  });

  it('cloud reads the armed claim', async () => {
    process.env[FLAVOUR_ENV] = 'cloud';
    delete process.env.DEMO_MODE;
    await expect(makeService(mock).publicStatus()).resolves.toEqual({
      claimRequired: true,
      claimExpiresAt: EXP,
    });
  });

  it('NAS with DEMO_MODE still reads (D-7: the fixture arms on NAS envs)', async () => {
    process.env[FLAVOUR_ENV] = 'nas';
    process.env.DEMO_MODE = 'true';
    await expect(makeService(mock).publicStatus()).resolves.toEqual({
      claimRequired: true,
      claimExpiresAt: EXP,
    });
  });
});

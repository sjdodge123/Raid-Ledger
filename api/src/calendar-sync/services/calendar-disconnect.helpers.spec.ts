import { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { _resetKeyCache } from '../../settings/encryption.util';
import { TransientError } from '../providers/calendar-provider.errors';
import type {
  CalendarAccountProvider,
  OAuthCredentials,
} from '../providers/calendar-provider.interface';
import { encryptCalendarCredentials } from './calendar-credentials.helpers';
import {
  runCalendarDisconnect,
  type AccountProviderResolver,
} from './calendar-disconnect.helpers';

const REFRESH = '1//DISCONNECT-SECRET-REFRESH';
const CREDS: OAuthCredentials = {
  kind: 'oauth',
  accessToken: 'ya29.DISCONNECT-SECRET-ACCESS',
  refreshToken: REFRESH,
  expiresAt: '2026-10-08T13:00:00.000Z',
  scopes: ['openid'],
};

function ownRow() {
  return {
    id: 5,
    provider: 'google',
    accountSubject: '1098',
    credentialsEncrypted: encryptCalendarCredentials(CREDS),
  };
}

/** First `.limit()` = the own-row load, second = the post-delete sibling probe. */
function dbWith(own: unknown[], siblings: unknown[] = []): MockDb {
  const db = createDrizzleMock();
  db.limit.mockResolvedValueOnce(own).mockResolvedValueOnce(siblings);
  return db;
}

function setup(disconnect = jest.fn().mockResolvedValue(undefined)) {
  const provider = { disconnect } as unknown as CalendarAccountProvider;
  const registry: AccountProviderResolver = {
    getAccountProviderForConnection: jest.fn().mockResolvedValue(provider),
  };
  return { disconnect, registry };
}

const run = (db: MockDb, registry: AccountProviderResolver) =>
  runCalendarDisconnect(db as never, registry, { userId: 3, connectionId: 5 });

beforeAll(() => {
  process.env.JWT_SECRET = 'calendar-disconnect-spec-secret';
  _resetKeyCache();
});

afterEach(() => jest.restoreAllMocks());

describe('runCalendarDisconnect', () => {
  it('own row, no sibling → marks disconnecting, deletes, then revokes with the stored token', async () => {
    const db = dbWith([ownRow()]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({
      found: true,
      revoke: 'revoked',
    });
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'disconnecting',
        updatedAt: expect.any(Date),
      }),
    );
    expect(disconnect).toHaveBeenCalledWith(CREDS);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(disconnect.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.delete.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('last sibling: the account is counted AFTER the delete, and none remain → revoke runs', async () => {
    const db = dbWith([ownRow()], []);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({
      found: true,
      revoke: 'revoked',
    });
    // The sibling probe is the second .limit(); it must follow the delete, or
    // two concurrent disconnects each see the other and both skip the revoke.
    expect(db.limit.mock.invocationCallOrder[1]).toBeGreaterThan(
      db.delete.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(disconnect).toHaveBeenCalledWith(CREDS);
  });

  it('a sibling row shares the account subject → revoke skipped, row still deleted', async () => {
    const db = dbWith([ownRow()], [{ id: 6 }]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({
      found: true,
      revoke: 'skipped_sibling',
    });
    expect(disconnect).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('revoke fails (provider 500) → still deleted; the warn names the code, never a token', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const db = dbWith([ownRow()]);
    const { registry } = setup(
      jest.fn().mockRejectedValue(new TransientError('http_500')),
    );
    await expect(run(db, registry)).resolves.toEqual({
      found: true,
      revoke: 'failed',
    });
    expect(db.delete).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('transient:http_500');
    expect(logged).not.toContain(REFRESH);
  });

  it('no adapter for the row (e.g. demo-fake with the gate closed) → skip revoke, delete', async () => {
    const db = dbWith([ownRow()]);
    const registry: AccountProviderResolver = {
      getAccountProviderForConnection: jest.fn().mockResolvedValue(null),
    };
    await expect(run(db, registry)).resolves.toEqual({
      found: true,
      revoke: 'skipped_no_provider',
    });
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it("another user's connection id → not found; nothing updated, revoked or deleted", async () => {
    const db = dbWith([]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({ found: false });
    expect(db.update).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});

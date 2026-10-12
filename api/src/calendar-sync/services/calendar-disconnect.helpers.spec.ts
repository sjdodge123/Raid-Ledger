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
import { calendarBusyBlocks } from '../../drizzle/schema';
import { encryptCalendarCredentials } from './calendar-credentials.helpers';
import {
  markCalendarDisconnecting,
  runCalendarDisconnect,
  type CalendarDisconnectRegistry,
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
    status: 'disconnecting',
    dedicatedCalendarId: null,
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
  // No write adapter → remote cleanup is skipped; integration covers it (D7).
  const registry: CalendarDisconnectRegistry = {
    getAccountProviderForConnection: jest.fn().mockResolvedValue(provider),
    getWriteProviderForConnection: jest.fn().mockResolvedValue(null),
  };
  return { disconnect, registry };
}

const run = (db: MockDb, registry: CalendarDisconnectRegistry) =>
  runCalendarDisconnect({ db: db as never, registry }, 5);
const done = (revoke: string) => ({
  found: true,
  remote: 'skipped_no_provider',
  revoke,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'calendar-disconnect-spec-secret';
  _resetKeyCache();
});

afterEach(() => jest.restoreAllMocks());

describe('markCalendarDisconnecting (the request half, D7)', () => {
  it('own row → set status disconnecting, scoped to id AND user → true', async () => {
    const db = createDrizzleMock();
    db.returning
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([{ userId: 3 }]);
    await expect(
      markCalendarDisconnecting(db as never, { userId: 3, connectionId: 5 }),
    ).resolves.toBe(true);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'disconnecting',
        updatedAt: expect.any(Date),
      }),
    );
    // ROK-1593 D-R7: the request also deletes this connection's busy
    // blocks (only them — the row itself goes in the job).
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(calendarBusyBlocks);
  });

  it("another user's connection id → false (404), nothing deleted", async () => {
    const db = createDrizzleMock();
    db.returning.mockResolvedValueOnce([]);
    await expect(
      markCalendarDisconnecting(db as never, { userId: 3, connectionId: 5 }),
    ).resolves.toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('runCalendarDisconnect (the job body)', () => {
  it('disconnecting row, no sibling → deletes, then revokes with the stored token', async () => {
    const db = dbWith([ownRow()]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual(done('revoked'));
    expect(disconnect).toHaveBeenCalledWith(CREDS);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(disconnect.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.delete.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('last sibling: the account is counted AFTER the delete, and none remain → revoke runs', async () => {
    const db = dbWith([ownRow()], []);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual(done('revoked'));
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
    await expect(run(db, registry)).resolves.toEqual(done('skipped_sibling'));
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
    await expect(run(db, registry)).resolves.toEqual(done('failed'));
    expect(db.delete).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('transient:http_500');
    expect(logged).not.toContain(REFRESH);
  });

  it('no adapter for the row (e.g. demo-fake with the gate closed) → skip revoke, delete', async () => {
    const db = dbWith([ownRow()]);
    const registry: CalendarDisconnectRegistry = {
      getAccountProviderForConnection: jest.fn().mockResolvedValue(null),
      getWriteProviderForConnection: jest.fn().mockResolvedValue(null),
    };
    await expect(run(db, registry)).resolves.toEqual(
      done('skipped_no_provider'),
    );
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('row already gone → not found; nothing updated, revoked or deleted', async () => {
    const db = dbWith([]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({ found: false });
    expect(db.update).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('row no longer disconnecting (reconnected before the job ran) → untouched', async () => {
    const db = dbWith([{ ...ownRow(), status: 'active' }]);
    const { disconnect, registry } = setup();
    await expect(run(db, registry)).resolves.toEqual({ found: false });
    expect(disconnect).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});

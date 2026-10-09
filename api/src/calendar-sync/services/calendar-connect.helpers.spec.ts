import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { at } from '../../common/testing/narrow';
import { _resetKeyCache } from '../../settings/encryption.util';
import { ProviderAuthError } from '../providers/calendar-provider.errors';
import type {
  ConnectResult,
  OAuthTokenGrant,
} from '../providers/calendar-provider.interface';
import {
  mergeGrantWithStored,
  upsertCalendarConnection,
} from './calendar-connect.helpers';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './calendar-credentials.helpers';

const STORED_REFRESH = '1//STORED-REFRESH';

function grant(refreshToken: string | null): OAuthTokenGrant {
  return {
    kind: 'oauth',
    accessToken: 'ya29.NEW-ACCESS',
    refreshToken,
    expiresAt: '2026-10-08T13:00:00.000Z',
    scopes: ['openid'],
  };
}

function result(
  refreshToken: string | null,
  label: string | null = 'new@example.test',
): ConnectResult {
  return {
    credentials: grant(refreshToken),
    accountSubject: '109876543210987654321',
    accountLabel: label,
  };
}

function storedBlob(): string {
  return encryptCalendarCredentials({
    ...grant(STORED_REFRESH),
    refreshToken: STORED_REFRESH,
    accessToken: 'ya29.OLD',
  });
}

function dbWith(
  existing: Array<{ id: number; credentialsEncrypted: string }>,
): MockDb {
  const db = createDrizzleMock();
  db.limit.mockResolvedValueOnce(existing);
  db.returning.mockResolvedValueOnce([{ id: 7 }]);
  return db;
}

type Written = {
  credentialsEncrypted: string;
  accountLabel?: string | null;
} & Record<string, unknown>;
const conflictSet = (db: MockDb) =>
  (at(db.onConflictDoUpdate.mock.calls, 0)[0] as { set: Written }).set;

beforeAll(() => {
  process.env.JWT_SECRET = 'calendar-connect-spec-secret';
  _resetKeyCache();
});

describe('upsertCalendarConnection', () => {
  it('first connect → created, encrypted credentials, status active', async () => {
    const db = dbWith([]);
    const out = await upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result('1//FRESH'),
    });
    expect(out).toEqual({ id: 7, outcome: 'created' });
    const values = at(db.values.mock.calls, 0)[0] as Written;
    expect(values).toMatchObject({
      userId: 3,
      provider: 'google',
      accountSubject: '109876543210987654321',
      status: 'active',
    });
    expect(
      decryptCalendarCredentials(values.credentialsEncrypted),
    ).toMatchObject({ refreshToken: '1//FRESH' });
  });

  it('L8: re-connect without a refresh token keeps the stored one → updated', async () => {
    const db = dbWith([{ id: 7, credentialsEncrypted: storedBlob() }]);
    const out = await upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result(null),
    });
    expect(out).toEqual({ id: 7, outcome: 'updated' });
    const kept = decryptCalendarCredentials(
      conflictSet(db).credentialsEncrypted,
    );
    expect(kept).toMatchObject({
      refreshToken: STORED_REFRESH,
      accessToken: 'ya29.NEW-ACCESS',
    });
  });

  it('a new refresh token replaces the stored one', async () => {
    const db = dbWith([{ id: 7, credentialsEncrypted: storedBlob() }]);
    await upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result('1//ROTATED'),
    });
    expect(
      decryptCalendarCredentials(conflictSet(db).credentialsEncrypted),
    ).toMatchObject({ refreshToken: '1//ROTATED' });
  });

  it('update sets label/status/error/updated_at and never touches read/write settings', async () => {
    const db = dbWith([{ id: 7, credentialsEncrypted: storedBlob() }]);
    await upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result(null, 'renamed@example.test'),
    });
    const set = conflictSet(db);
    expect(set).toMatchObject({
      accountLabel: 'renamed@example.test',
      status: 'active',
      lastErrorCode: null,
    });
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(
      Object.keys(set).filter((k) => /^(read|write|dedicated)/.test(k)),
    ).toEqual([]);
  });

  it('a grant without an email keeps the stored label (undefined is skipped)', async () => {
    const db = dbWith([{ id: 7, credentialsEncrypted: storedBlob() }]);
    await upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result(null, null),
    });
    expect(conflictSet(db).accountLabel).toBeUndefined();
  });

  it('no refresh token anywhere → ProviderAuthError(missing_refresh_token), nothing written', async () => {
    const db = dbWith([]);
    const p = upsertCalendarConnection(db as never, {
      userId: 3,
      provider: 'google',
      result: result(null),
    });
    await expect(p).rejects.toBeInstanceOf(ProviderAuthError);
    await expect(p).rejects.toMatchObject({ reason: 'missing_refresh_token' });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('mergeGrantWithStored', () => {
  it('prefers the grant, falls back to stored oauth, else null', () => {
    const stored = decryptCalendarCredentials(storedBlob());
    expect(mergeGrantWithStored(grant('1//G'), stored)?.refreshToken).toBe(
      '1//G',
    );
    expect(mergeGrantWithStored(grant(null), stored)?.refreshToken).toBe(
      STORED_REFRESH,
    );
    expect(mergeGrantWithStored(grant(null), null)).toBeNull();
    expect(
      mergeGrantWithStored(grant(null), {
        kind: 'caldav',
        username: 'u',
        appPassword: 'p',
      }),
    ).toBeNull();
  });
});

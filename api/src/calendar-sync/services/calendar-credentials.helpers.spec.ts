import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { at } from '../../common/testing/narrow';
import { _resetKeyCache } from '../../settings/encryption.util';
import type { OAuthCredentials } from '../providers/calendar-provider.interface';
import {
  CalendarCredentialsUnreadableError,
  decryptCalendarCredentials,
  encryptCalendarCredentials,
  isEncryptedCredentials,
  toSafeConnectionView,
  withFreshCredentials,
} from './calendar-credentials.helpers';
import { toCalendarConnection } from './calendar-overview.helpers';

const NOW = Date.UTC(2026, 9, 8, 12);
const ACCESS = 'ya29.UNIT-SECRET-ACCESS';
const REFRESH = '1//UNIT-SECRET-REFRESH';

function creds(expiresInMs: number): OAuthCredentials {
  return {
    kind: 'oauth',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: new Date(NOW + expiresInMs).toISOString(),
    scopes: ['openid', 'email'],
  };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'calendar-credentials-spec-secret';
  _resetKeyCache();
});

afterAll(() => _resetKeyCache());

describe('calendar credentials crypto', () => {
  it('encrypts to an isEncrypted blob with no plaintext token, and round-trips', () => {
    const blob = encryptCalendarCredentials(creds(3_600_000));
    expect(isEncryptedCredentials(blob)).toBe(true);
    expect(blob).not.toContain(ACCESS);
    expect(blob).not.toContain(REFRESH);
    expect(decryptCalendarCredentials(blob)).toEqual(creds(3_600_000));
  });

  it('a plaintext JSON blob is not "encrypted"', () => {
    expect(isEncryptedCredentials(JSON.stringify(creds(0)))).toBe(false);
  });

  it('garbage → CalendarCredentialsUnreadableError carrying no content', () => {
    const fn = () => decryptCalendarCredentials('aa:bb:cc');
    expect(fn).toThrow(CalendarCredentialsUnreadableError);
    expect(fn).toThrow('calendar credentials unreadable');
  });

  it('an encrypted blob of the wrong shape → unreadable', () => {
    const { encrypt } = jest.requireActual<
      typeof import('../../settings/encryption.util')
    >('../../settings/encryption.util');
    const blob = encrypt(
      JSON.stringify({ kind: 'oauth', accessToken: ACCESS }),
    );
    expect(() => decryptCalendarCredentials(blob)).toThrow(
      CalendarCredentialsUnreadableError,
    );
  });
});

describe('DTO mappers never carry credentials', () => {
  const blob = (): string => encryptCalendarCredentials(creds(3_600_000));
  const leaky = () => ({
    id: 1,
    userId: 2,
    provider: 'google',
    accountLabel: 'raider@example.test',
    status: 'active',
    credentialsEncrypted: blob(),
    ...creds(3_600_000),
  });

  it.each([
    ['toSafeConnectionView', () => toSafeConnectionView(leaky())],
    [
      'toCalendarConnection',
      () =>
        toCalendarConnection({
          ...leaky(),
          lastSyncedAt: null,
          lastErrorCode: null,
          readEnabled: false,
          readCalendarIds: [],
          writeEnabled: false,
          writeTarget: 'dedicated',
        }),
    ],
  ])('%s output has no token, no blob', (_name, map) => {
    const json = JSON.stringify(map());
    expect(json).not.toContain(ACCESS);
    expect(json).not.toContain(REFRESH);
    expect(json).not.toMatch(/credentials|refreshToken|accessToken/i);
  });
});

describe('withFreshCredentials', () => {
  it('a token with time left is used as-is: no refresh, no write', async () => {
    const db = createDrizzleMock();
    const refresh = jest.fn();
    const fn = jest.fn().mockResolvedValue('ok');
    const conn = {
      id: 9,
      credentialsEncrypted: encryptCalendarCredentials(creds(3_600_000)),
    };
    await expect(
      withFreshCredentials(db as never, conn, { refresh }, fn, NOW),
    ).resolves.toBe('ok');
    expect(refresh).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledWith(creds(3_600_000));
  });

  it('under 60 s left → refresh, persist the rotated blob + updated_at, then run', async () => {
    const db = createDrizzleMock();
    const rotated = { ...creds(3_600_000), accessToken: 'ya29.ROTATED' };
    const refresh = jest.fn().mockResolvedValue(rotated);
    const fn = jest.fn().mockResolvedValue(undefined);
    const conn = {
      id: 9,
      credentialsEncrypted: encryptCalendarCredentials(creds(30_000)),
    };
    await withFreshCredentials(db as never, conn, { refresh }, fn, NOW);
    expect(refresh).toHaveBeenCalledWith(creds(30_000));
    const set = at(db.set.mock.calls, 0)[0] as {
      credentialsEncrypted: string;
      updatedAt: unknown;
    };
    expect(decryptCalendarCredentials(set.credentialsEncrypted)).toEqual(
      rotated,
    );
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(fn).toHaveBeenCalledWith(rotated);
  });
});

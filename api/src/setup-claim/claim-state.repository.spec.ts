import { appSettings, SETTING_KEYS } from '../drizzle/schema/app-settings';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { decrypt, encrypt } from '../settings/encryption.util';
import {
  armClaim,
  type ClaimDb,
  type ClaimState,
  clearClaimState,
  isClaimRequired,
  markClaimed,
  readClaimState,
  readRestoreHash,
  toClaimState,
} from './claim-state.repository';

const HASH = 'a'.repeat(64);
const EXP = '2026-11-02T05:00:00.000Z';
const CLAIMED = '2026-10-31T09:30:00.000Z';

function asDb(mock: MockDb): ClaimDb {
  // The chain mock stands in for drizzle; only the methods used are called.
  return mock as unknown as ClaimDb;
}

function row(key: string, value: string) {
  return { key, encryptedValue: encrypt(value) };
}

/** Every `.values({...})` payload written, decrypted, by key. */
function writtenValues(mock: MockDb): Map<string, string> {
  const out = new Map<string, string>();
  for (const [arg] of mock.values.mock.calls as Array<
    [{ key: string; encryptedValue: string }]
  >) {
    out.set(arg.key, decrypt(arg.encryptedValue));
  }
  return out;
}

describe('toClaimState / isClaimRequired', () => {
  it('reads an armed, unclaimed state', () => {
    const state = toClaimState([
      row(SETTING_KEYS.CLAIM_CODE_HASH, HASH),
      row(SETTING_KEYS.CLAIM_EXPIRES_AT, EXP),
    ]);
    expect(state).toEqual({
      codeHash: HASH,
      expiresAt: new Date(EXP),
      claimedAt: null,
    });
    expect(isClaimRequired(state)).toBe(true);
  });

  it('treats an unparsable time as absent', () => {
    const state = toClaimState([
      row(SETTING_KEYS.CLAIM_EXPIRES_AT, 'not-a-date'),
    ]);
    expect(state.expiresAt).toBeNull();
  });

  it.each<[string, ClaimState, boolean]>([
    [
      'never armed (NAS)',
      { codeHash: null, expiresAt: null, claimedAt: null },
      false,
    ],
    [
      'armed',
      { codeHash: HASH, expiresAt: new Date(EXP), claimedAt: null },
      true,
    ],
    [
      'armed but expired (still required)',
      { codeHash: HASH, expiresAt: new Date(0), claimedAt: null },
      true,
    ],
    [
      'claimed',
      { codeHash: null, expiresAt: null, claimedAt: new Date(CLAIMED) },
      false,
    ],
    [
      'claimed with a stray hash',
      { codeHash: HASH, expiresAt: null, claimedAt: new Date(CLAIMED) },
      false,
    ],
  ])('claimRequired when %s → %s', (_label, state, expected) => {
    expect(isClaimRequired(state)).toBe(expected);
  });
});

describe('readClaimState', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
  });

  it('decrypts the rows of one plain SELECT', async () => {
    mock.where.mockResolvedValueOnce([
      row(SETTING_KEYS.CLAIM_CODE_HASH, HASH),
      row(SETTING_KEYS.CLAIMED_AT, CLAIMED),
    ]);
    const state = await readClaimState(asDb(mock));
    expect(state).toEqual({
      codeHash: HASH,
      expiresAt: null,
      claimedAt: new Date(CLAIMED),
    });
    expect(mock.from).toHaveBeenCalledWith(appSettings);
    expect(mock.for).not.toHaveBeenCalled();
  });

  it('row-locks with FOR UPDATE when asked', async () => {
    mock.for.mockResolvedValueOnce([row(SETTING_KEYS.CLAIM_CODE_HASH, HASH)]);
    const state = await readClaimState(asDb(mock), { forUpdate: true });
    expect(mock.for).toHaveBeenCalledWith('update');
    expect(state.codeHash).toBe(HASH);
  });
});

describe('writes', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
  });

  it('armClaim upserts the hash and expiry, encrypted at rest', async () => {
    await armClaim(asDb(mock), { codeHash: HASH, expiresAt: new Date(EXP) });
    const written = writtenValues(mock);
    expect(Object.fromEntries(written)).toEqual({
      [SETTING_KEYS.CLAIM_CODE_HASH]: HASH,
      [SETTING_KEYS.CLAIM_EXPIRES_AT]: EXP,
    });
    for (const [arg] of mock.values.mock.calls as Array<
      [{ encryptedValue: string }]
    >) {
      expect(arg.encryptedValue).not.toContain(HASH);
    }
    expect(mock.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(mock.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: appSettings.key }),
    );
  });

  it('armClaim writes both rows inside ONE transaction', async () => {
    const tx = createDrizzleMock();
    mock.transaction.mockImplementationOnce(
      async (cb: (t: MockDb) => Promise<unknown>) => cb(tx),
    );
    await armClaim(asDb(mock), { codeHash: HASH, expiresAt: new Date(EXP) });
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.insert).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('markClaimed records claimed_at and deletes hash + expiry', async () => {
    await markClaimed(asDb(mock), new Date(CLAIMED));
    expect(Object.fromEntries(writtenValues(mock))).toEqual({
      [SETTING_KEYS.CLAIMED_AT]: CLAIMED,
    });
    expect(mock.delete).toHaveBeenCalledWith(appSettings);
    expect(mock.where).toHaveBeenCalledTimes(1);
  });

  it('clearClaimState deletes without writing', async () => {
    await clearClaimState(asDb(mock));
    expect(mock.delete).toHaveBeenCalledWith(appSettings);
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('readRestoreHash decrypts the snapshot or returns null', async () => {
    mock.limit.mockResolvedValueOnce([
      { encryptedValue: encrypt('$2b$12$hash') },
    ]);
    await expect(readRestoreHash(asDb(mock))).resolves.toBe('$2b$12$hash');
    mock.limit.mockResolvedValueOnce([]);
    await expect(readRestoreHash(asDb(mock))).resolves.toBeNull();
  });
});

/**
 * ROK-2370 — SigninCodeStore single-use guarantees, against the in-memory
 * Redis mock. The race tests replay stale reads: a confirmation (or a poll)
 * that read the code before another request consumed it.
 */
import type Redis from 'ioredis';
import {
  createRedisMock,
  type RedisMockHandle,
} from '../common/testing/redis-mock';
import {
  approvalKey,
  codeKey,
  deviceKey,
  hashDeviceSecret,
} from './signin-code.helpers';
import { SigninCodeStore, type SigninCodeApproval } from './signin-code.store';

const SECRET = 's'.repeat(43);

function approval(token: string): SigninCodeApproval {
  return { kind: 'existing', token, displayName: token };
}

let handle: RedisMockHandle;
let store: SigninCodeStore;

beforeEach(() => {
  handle = createRedisMock();
  store = new SigninCodeStore(handle.client as unknown as Redis);
});

/** Snapshot what a request that started now would have read. */
function snapshotReads(code: string): Array<[string, string]> {
  const keys = [codeKey(code), deviceKey(hashDeviceSecret(SECRET))];
  return keys.flatMap((key) => {
    const value = handle.store.get(key);
    return value === undefined ? [] : [[key, value] as [string, string]];
  });
}

/** Put back anything a concurrent take removed, as a stale reader sees it. */
function replayStaleReads(reads: Array<[string, string]>): void {
  for (const [key, value] of reads) handle.store.set(key, value);
}

describe('SigninCodeStore', () => {
  it('hands an approval out once, then reads expired', async () => {
    const { code } = await store.create(SECRET);
    expect(await store.takeBySecret(SECRET)).toMatchObject({
      status: 'pending',
    });
    expect(await store.approve(code, approval('a'))).toBe(true);
    expect(await store.takeBySecret(SECRET)).toEqual({
      status: 'approved',
      approval: approval('a'),
    });
    expect(await store.takeBySecret(SECRET)).toEqual({ status: 'expired' });
  });

  it('a confirmation that read the code before the take cannot re-approve it (Codex P2)', async () => {
    const { code } = await store.create(SECRET);
    expect(await store.approve(code, approval('first'))).toBe(true);
    const stale = snapshotReads(code);
    await store.takeBySecret(SECRET);

    replayStaleReads(stale);
    const second = await store.approve(code, approval('second'));
    const poll = await store.takeBySecret(SECRET);

    expect({ second, poll }).toEqual({
      second: false,
      poll: { status: 'expired' },
    });
  });

  it('reads a corrupt pending record as expired', async () => {
    const { code } = await store.create(SECRET);
    // Unexpired by its own expiresAt, so only the schema check (a numeric
    // secretHash) can reject it — a bare `JSON.parse as CodeRecord` reads it as live.
    handle.store.set(
      codeKey(code),
      JSON.stringify({ secretHash: 1, createdAt: 0, expiresAt: 9e15 }),
    );
    expect(await store.findPending(code)).toBeNull();
    expect(await store.approve(code, approval('a'))).toBe(false);
    expect(await store.takeBySecret(SECRET)).toEqual({ status: 'expired' });
  });

  it('reads a corrupt approval as expired, never as a sign-in', async () => {
    const { code } = await store.create(SECRET);
    handle.store.set(approvalKey(code), '{"token":"t","displayName":"x"}');
    expect(await store.takeBySecret(SECRET)).toEqual({ status: 'expired' });
  });
});

import * as singleUseToken from '../../auth/single-use-token.helpers';
import { signState } from '../../common/signed-state.helpers';
import {
  CALENDAR_OAUTH_NONCE_PREFIX,
  codeChallengeFor,
  mintCalendarOAuthState,
  verifyCalendarOAuthState,
  type VerifiedCalendarOAuthState,
} from './calendar-oauth-state.helpers';

const db = {} as never; // consumeTokenOnce is spied; the db is never touched
const NOW = Date.UTC(2026, 9, 8, 12);
const R = 'browser-binding-r';
let consume: jest.SpyInstance;

const boundTo =
  (want: string) =>
  (r: unknown): void => {
    if (r !== want) throw new Error('Link request expired. Please try again.');
  };

function mint(r = R) {
  return mintCalendarOAuthState({
    uid: 42,
    provider: 'google',
    bindToBrowser: () => r,
    nowMs: NOW,
  });
}

function verify(state: string, opts: { r?: string; nowMs?: number } = {}) {
  return verifyCalendarOAuthState(db, state, {
    provider: 'google',
    assertBoundToBrowser: boundTo(opts.r ?? R),
    nowMs: opts.nowMs ?? NOW + 1_000,
  });
}

function must(
  v: VerifiedCalendarOAuthState | null,
): VerifiedCalendarOAuthState {
  if (!v) throw new Error('expected a verified state, got null');
  return v;
}

beforeEach(() => {
  process.env.JWT_SECRET = 'calendar-state-spec-secret';
  consume = jest
    .spyOn(singleUseToken, 'consumeTokenOnce')
    .mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('calendar OAuth state', () => {
  it('round-trips: the derived verifier hashes to the minted S256 challenge', async () => {
    const { state, codeChallenge } = mint();
    const v = must(await verify(state));
    expect(v.uid).toBe(42);
    expect(v.provider).toBe('google');
    expect(v.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallengeFor(v.codeVerifier)).toBe(codeChallenge);
    expect(consume).toHaveBeenCalledWith(
      db,
      expect.stringMatching(new RegExp(`^${CALENDAR_OAUTH_NONCE_PREFIX}.+`)),
    );
  });

  it('never puts the verifier in the state', async () => {
    const { state } = mint();
    const v = must(await verify(state));
    const body = Buffer.from(state.split('.')[0] ?? '', 'base64url').toString();
    expect(state).not.toContain(v.codeVerifier);
    expect(body).not.toContain(v.codeVerifier);
  });

  it('two starts get different nonces, verifiers and challenges', () => {
    expect(mint().codeChallenge).not.toBe(mint().codeChallenge);
  });

  it('tampered state → null, nonce not consumed', async () => {
    const { state } = mint();
    const [body, sig] = state.split('.') as [string, string];
    const forged = Buffer.from(
      Buffer.from(body, 'base64url').toString().replace('"uid":42', '"uid":43'),
    ).toString('base64url');
    expect(await verify(`${forged}.${sig}`)).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });

  it('expired state (past 10 minutes) → null', async () => {
    const { state } = mint();
    expect(await verify(state, { nowMs: NOW + 601_000 })).toBeNull();
  });

  it('a state signed under another key → null', async () => {
    const { state } = mint();
    process.env.JWT_SECRET = 'a-different-server-secret';
    expect(await verify(state)).toBeNull();
  });

  it('wrong provider → null', async () => {
    const { state } = mint();
    const v = await verifyCalendarOAuthState(db, state, {
      provider: 'microsoft',
      assertBoundToBrowser: boundTo(R),
      nowMs: NOW + 1_000,
    });
    expect(v).toBeNull();
  });

  it('a same-purpose token without a nonce → null', async () => {
    const bare = signState(
      { uid: 42, provider: 'google', r: R },
      'calendar-oauth',
      {
        nowMs: NOW,
      },
    );
    expect(await verify(bare)).toBeNull();
  });

  it('another browser (binding mismatch) → null, nonce not consumed', async () => {
    const { state } = mint();
    expect(await verify(state, { r: 'someone-elses-cookie' })).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });

  it('replayed state (nonce already consumed) → null', async () => {
    const { state } = mint();
    consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await verify(state)).not.toBeNull();
    expect(await verify(state)).toBeNull();
  });
});

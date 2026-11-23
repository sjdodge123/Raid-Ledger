/**
 * ROK-2129 L1 (AC1, AC2): the Battle.net account-probe OAuth state.
 * `consumeTokenOnce` is spied, so the db is never touched.
 */
import { createHash } from 'node:crypto';
import * as singleUseToken from '../../auth/single-use-token.helpers';
import { signState } from '../../common/signed-state.helpers';
import {
  BNET_PROBE_NONCE_PREFIX,
  bnetProbeBindingHash,
  deriveBnetProbeVerifier,
  startBnetProbeState,
  verifyBnetProbeState,
  type BnetProbeStart,
  type VerifiedBnetProbeState,
} from './bnet-account-probe.state';

const db = {} as never; // consumeTokenOnce is spied; the db is never touched
const NOW = Date.UTC(2026, 10, 7, 12);
let consume: jest.SpyInstance;

function start(): BnetProbeStart {
  return startBnetProbeState({ uid: 42, region: 'eu', nowMs: NOW });
}

function verify(
  state: string,
  opts: { cookieHash?: string | undefined; nowMs?: number } = {},
  cookie: string | undefined = undefined,
): Promise<VerifiedBnetProbeState | null> {
  return verifyBnetProbeState(db, state, {
    cookieHash: 'cookieHash' in opts ? opts.cookieHash : cookie,
    nowMs: opts.nowMs ?? NOW + 1_000,
  });
}

function must(v: VerifiedBnetProbeState | null): VerifiedBnetProbeState {
  if (!v) throw new Error('expected a verified state, got null');
  return v;
}

/** The signed claims, decoded without verifying (test-side only). */
function claimsOf(state: string): Record<string, unknown> {
  const body = state.split('.')[0] ?? '';
  const parsed: unknown = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  );
  if (!parsed || typeof parsed !== 'object') throw new Error('bad claims');
  return parsed as Record<string, unknown>;
}

/** A correctly signed probe state carrying arbitrary claims. */
function craft(fields: Record<string, unknown>): string {
  return signState(
    { uid: 42, n: 'nonce-1', r: 'r-1', g: 'us', ...fields },
    'bnet-account-probe',
    {
      nowMs: NOW,
    },
  );
}

beforeEach(() => {
  process.env.JWT_SECRET = 'bnet-probe-state-spec-secret';
  consume = jest
    .spyOn(singleUseToken, 'consumeTokenOnce')
    .mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('Battle.net probe state — round trip (AC1)', () => {
  it('returns uid + region and a verifier whose S256 is the minted challenge', async () => {
    const s = start();
    const v = must(await verify(s.state, {}, s.bindingCookieValue));
    expect(v.uid).toBe(42);
    expect(v.region).toBe('eu');
    const s256 = createHash('sha256')
      .update(v.codeVerifier)
      .digest('base64url');
    expect(s256).toBe(s.codeChallenge);
  });

  it('derives an RFC 7636 verifier (43 base64url chars) that is never in the state', () => {
    const s = start();
    const n = claimsOf(s.state).n;
    if (typeof n !== 'string') throw new Error('state carries no nonce');
    const verifier = deriveBnetProbeVerifier(n);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.state).not.toContain(verifier);
  });

  it('cookie value is sha256(r), not r itself', () => {
    const s = start();
    const r = claimsOf(s.state).r;
    if (typeof r !== 'string') throw new Error('state carries no r');
    expect(s.bindingCookieValue).toBe(bnetProbeBindingHash(r));
    expect(s.bindingCookieValue).not.toBe(r);
  });

  it('mints a fresh nonce per start', () => {
    expect(claimsOf(start().state).n).not.toBe(claimsOf(start().state).n);
  });

  it('consumes the nonce under the probe prefix', async () => {
    const s = start();
    await verify(s.state, {}, s.bindingCookieValue);
    expect(consume).toHaveBeenCalledWith(
      db,
      `${BNET_PROBE_NONCE_PREFIX}${String(claimsOf(s.state).n)}`,
    );
  });
});

const cookie = bnetProbeBindingHash('r-1');

const unconsumed: Array<
  [string, () => Promise<VerifiedBnetProbeState | null>]
> = [
  [
    'tampered body',
    () => {
      const [body, sig] = craft({}).split('.');
      const json = Buffer.from(body ?? '', 'base64url').toString('utf8');
      const forged = Buffer.from(json.replace('"uid":42', '"uid":43')).toString(
        'base64url',
      );
      return verify(`${forged}.${sig ?? ''}`, {}, cookie);
    },
  ],
  [
    'tampered signature',
    () => {
      const [body, sig = ''] = craft({}).split('.');
      const flipped = `${sig.startsWith('A') ? 'B' : 'A'}${sig.slice(1)}`;
      return verify(`${body ?? ''}.${flipped}`, {}, cookie);
    },
  ],
  [
    'calendar-oauth purpose',
    () =>
      verify(
        signState(
          { uid: 42, n: 'nonce-1', r: 'r-1', g: 'us' },
          'calendar-oauth',
          { nowMs: NOW },
        ),
        {},
        cookie,
      ),
  ],
  [
    'expired (now + 601 s)',
    () => verify(craft({}), { nowMs: NOW + 601_000 }, cookie),
  ],
  ['unknown region', () => verify(craft({ g: 'kr' }), {}, cookie)],
  ['missing region', () => verify(craft({ g: undefined }), {}, cookie)],
  ['missing nonce', () => verify(craft({ n: '' }), {}, cookie)],
  ['missing binding r', () => verify(craft({ r: 7 }), {}, cookie)],
  ['missing cookie', () => verify(craft({}), { cookieHash: undefined })],
  [
    'mismatched cookie',
    () => verify(craft({}), {}, bnetProbeBindingHash('r-other')),
  ],
  ['cookie equal to raw r', () => verify(craft({}), {}, 'r-1')],
];

describe('Battle.net probe state — every miss is null (AC2)', () => {
  it.each(unconsumed)('%s → null, nonce NOT consumed', async (_label, run) => {
    expect(await run()).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });

  it('a second consume of the same nonce → null', async () => {
    consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const s = start();
    expect(await verify(s.state, {}, s.bindingCookieValue)).not.toBeNull();
    expect(await verify(s.state, {}, s.bindingCookieValue)).toBeNull();
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('a garbage token → null without consuming', async () => {
    expect(await verify('not-a-state', {}, cookie)).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });
});

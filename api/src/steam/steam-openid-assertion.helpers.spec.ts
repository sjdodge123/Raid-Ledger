/**
 * Unit tests for validateSteamAssertion (ROK-1731 AC1a).
 *
 * Every rejection branch asserts its own `reason`, so removing a check makes
 * that row fail with an expected-vs-actual diff (not a timeout or a throw).
 */
import {
  STEAM_NONCE_FUTURE_SKEW_MS,
  STEAM_NONCE_MAX_AGE_MS,
  STEAM_OPENID_NS,
  STEAM_OPENID_REQUIRED_SIGNED,
  validateSteamAssertion,
} from './steam-openid-assertion.helpers';
import { STEAM_OPENID_URL } from './steam-http.util';

const CALLBACK = 'https://raid.example.com/api/auth/steam/link/callback';
const STATE = 'signed-state.abc123';
const NOW = Date.parse('2026-10-04T12:00:00Z');
const CLAIMED = 'https://steamcommunity.com/openid/id/76561198000000001';
const NONCE = '2026-10-04T11:59:30ZAbCdEf123=';

function fixture(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const base: Record<string, string | undefined> = {
    'openid.ns': STEAM_OPENID_NS,
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_URL,
    'openid.claimed_id': CLAIMED,
    'openid.identity': CLAIMED,
    'openid.return_to': `${CALLBACK}?state=${encodeURIComponent(STATE)}`,
    'openid.response_nonce': NONCE,
    'openid.assoc_handle': '1234567890',
    'openid.signed':
      'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  return out;
}

function run(
  overrides: Record<string, string | undefined> = {},
  state = STATE,
  now = NOW,
) {
  return validateSteamAssertion(fixture(overrides), CALLBACK, state, now);
}

function nonceAt(ms: number): string {
  return `${new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')}xyz`;
}

describe('validateSteamAssertion — accepts', () => {
  it('accepts the canonical Steam assertion and returns its nonce', () => {
    expect(run()).toEqual({ ok: true, nonce: NONCE });
  });

  it('accepts a nonce exactly at the max age and at the future skew', () => {
    expect(
      run({ 'openid.response_nonce': nonceAt(NOW - STEAM_NONCE_MAX_AGE_MS) }),
    ).toMatchObject({ ok: true });
    expect(
      run({
        'openid.response_nonce': nonceAt(NOW + STEAM_NONCE_FUTURE_SKEW_MS),
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('validateSteamAssertion — envelope', () => {
  it.each([
    ['openid.ns', 'http://openid.net/signon/1.1', 'bad openid.ns'],
    ['openid.ns', undefined, 'bad openid.ns'],
    ['openid.mode', 'cancel', 'bad openid.mode'],
    ['openid.mode', 'check_authentication', 'bad openid.mode'],
    [
      'openid.op_endpoint',
      'https://evil.example/openid/login',
      'bad openid.op_endpoint',
    ],
    ['openid.op_endpoint', `${STEAM_OPENID_URL}/`, 'bad openid.op_endpoint'],
    ['openid.op_endpoint', undefined, 'bad openid.op_endpoint'],
  ])('rejects %s=%p with "%s"', (field, value, reason) => {
    expect(run({ [field]: value })).toEqual({ ok: false, reason });
  });
});

describe('validateSteamAssertion — return_to', () => {
  it.each([
    [undefined, 'missing or unparseable openid.return_to'],
    ['not a url', 'missing or unparseable openid.return_to'],
    [
      `https://evil.example/api/auth/steam/link/callback?state=${STATE}`,
      'return_to origin mismatch',
    ],
    [
      `http://raid.example.com/api/auth/steam/link/callback?state=${STATE}`,
      'return_to origin mismatch',
    ],
    [
      `https://raid.example.com:8443/api/auth/steam/link/callback?state=${STATE}`,
      'return_to origin mismatch',
    ],
    [
      `https://raid.example.com/api/auth/steam/other?state=${STATE}`,
      'return_to path mismatch',
    ],
    [`${CALLBACK}?state=someone-elses-state`, 'return_to state mismatch'],
    [CALLBACK, 'return_to state mismatch'],
  ])('rejects return_to=%p with "%s"', (returnTo, reason) => {
    expect(run({ 'openid.return_to': returnTo })).toEqual({
      ok: false,
      reason,
    });
  });

  it('rejects when the callback request carries an empty state', () => {
    expect(run({ 'openid.return_to': `${CALLBACK}?state=` }, '')).toEqual({
      ok: false,
      reason: 'return_to state mismatch',
    });
  });
});

describe('validateSteamAssertion — identity', () => {
  const OTHER = 'https://steamcommunity.com/openid/id/76561198000000999';
  it.each([
    [{ 'openid.claimed_id': undefined }, 'bad openid.claimed_id'],
    [
      {
        'openid.claimed_id': 'https://evil.example/openid/id/1',
        'openid.identity': 'https://evil.example/openid/id/1',
      },
      'bad openid.claimed_id',
    ],
    [
      {
        'openid.claimed_id': `${CLAIMED}/extra`,
        'openid.identity': `${CLAIMED}/extra`,
      },
      'bad openid.claimed_id',
    ],
    [{ 'openid.identity': OTHER }, 'claimed_id != identity'],
    [{ 'openid.identity': undefined }, 'claimed_id != identity'],
  ])('rejects %p with "%s"', (overrides, reason) => {
    expect(run(overrides)).toEqual({ ok: false, reason });
  });
});

describe('validateSteamAssertion — openid.signed', () => {
  it.each(STEAM_OPENID_REQUIRED_SIGNED.map((f) => [f]))(
    'rejects when "%s" is not signed',
    (field) => {
      const signed = ['signed', ...STEAM_OPENID_REQUIRED_SIGNED]
        .filter((f) => f !== field)
        .join(',');
      expect(run({ 'openid.signed': signed })).toEqual({
        ok: false,
        reason: `openid.signed missing ${field}`,
      });
    },
  );

  it('pins the required signed list (OQ3 — change deliberately)', () => {
    expect([...STEAM_OPENID_REQUIRED_SIGNED].sort()).toEqual([
      'assoc_handle',
      'claimed_id',
      'identity',
      'op_endpoint',
      'response_nonce',
      'return_to',
    ]);
  });

  it('rejects a missing openid.signed', () => {
    expect(run({ 'openid.signed': undefined })).toEqual({
      ok: false,
      reason: 'openid.signed missing op_endpoint',
    });
  });

  it('does not accept a field only as a substring of another', () => {
    const signed =
      'op_endpoint,claimed_id,identityX,return_to,response_nonce,assoc_handle';
    expect(run({ 'openid.signed': signed })).toEqual({
      ok: false,
      reason: 'openid.signed missing identity',
    });
  });
});

describe('validateSteamAssertion — response_nonce', () => {
  it.each([
    [undefined, 'missing openid.response_nonce'],
    ['', 'missing openid.response_nonce'],
    ['abcdef', 'malformed openid.response_nonce'],
    ['2026-10-04 11:59:30Zabc', 'malformed openid.response_nonce'],
    ['2026-13-45T25:61:61Zabc', 'malformed openid.response_nonce'],
    [nonceAt(NOW - STEAM_NONCE_MAX_AGE_MS - 1000), 'stale response_nonce'],
    ['2026-10-03T12:00:00Zold', 'stale response_nonce'],
    [nonceAt(NOW + STEAM_NONCE_FUTURE_SKEW_MS + 1000), 'future response_nonce'],
  ])('rejects nonce=%p with "%s"', (nonce, reason) => {
    expect(run({ 'openid.response_nonce': nonce })).toEqual({
      ok: false,
      reason,
    });
  });

  it('defaults `now` to the wall clock', () => {
    const fresh = nonceAt(Date.now());
    const result = validateSteamAssertion(
      fixture({ 'openid.response_nonce': fresh }),
      CALLBACK,
      STATE,
    );
    expect(result).toEqual({ ok: true, nonce: fresh });
  });
});

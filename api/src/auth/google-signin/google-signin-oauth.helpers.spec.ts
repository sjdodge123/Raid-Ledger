import { JwtService } from '@nestjs/jwt';
import {
  buildGoogleSigninUrl,
  deriveSigninNonce,
  deriveSigninVerifier,
  signGoogleSigninState,
  signinCodeChallenge,
  verifyGoogleSigninState,
} from './google-signin-oauth.helpers';
import {
  GoogleSigninClaimError,
  readGoogleSigninClaims,
} from './google-signin-claims.helpers';

const CLIENT_ID = 'cid.apps.googleusercontent.com';

function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    exp: 4102444800,
    ...claims,
  })}.c2ln`;
}

beforeAll(() => {
  process.env.JWT_SECRET = 'unit-test-secret';
});

describe('buildGoogleSigninUrl', () => {
  it('sends sign-in params, never the calendar offline/consent ones', () => {
    const url = new URL(
      buildGoogleSigninUrl({
        clientId: CLIENT_ID,
        redirectUri: 'https://rl.test/api/auth/google/callback',
        state: 'st',
        n: 'seed',
      }),
    );
    const p = url.searchParams;
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('access_type')).toBe('online');
    expect(p.get('prompt')).toBe('select_account');
    expect(p.get('include_granted_scopes')).toBeNull();
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(
      signinCodeChallenge(deriveSigninVerifier('seed')),
    );
    expect(p.get('nonce')).toBe(deriveSigninNonce('seed'));
    expect(p.get('state')).toBe('st');
  });
});

describe('signed state', () => {
  const jwt = new JwtService({});

  it('round-trips and rejects a tampered token', () => {
    const { state, n } = signGoogleSigninState(jwt, {
      action: 'signin',
      r: 'bind',
    });
    expect(verifyGoogleSigninState(jwt, state)).toEqual({
      action: 'signin',
      n,
      r: 'bind',
    });
    expect(verifyGoogleSigninState(jwt, `${state}x`)).toBeNull();
  });

  it('requires a uid for link', () => {
    const { state } = signGoogleSigninState(jwt, { action: 'link', r: 'b' });
    expect(verifyGoogleSigninState(jwt, state)).toBeNull();
  });
});

describe('readGoogleSigninClaims', () => {
  it('accepts a matching nonce and reports email_verified', () => {
    const claims = readGoogleSigninClaims(
      idToken({ nonce: 'N', email_verified: true, given_name: 'Ada' }),
      CLIENT_ID,
      'N',
    );
    expect(claims).toEqual({
      sub: '1234567890',
      email: null,
      emailVerified: true,
      displayName: 'Ada',
    });
  });

  it('rejects a wrong or missing nonce', () => {
    expect(() =>
      readGoogleSigninClaims(idToken({ nonce: 'other' }), CLIENT_ID, 'N'),
    ).toThrow(GoogleSigninClaimError);
    expect(() => readGoogleSigninClaims(idToken({}), CLIENT_ID, 'N')).toThrow(
      GoogleSigninClaimError,
    );
  });

  it('treats a missing email_verified as unverified', () => {
    const claims = readGoogleSigninClaims(
      idToken({ nonce: 'N' }),
      CLIENT_ID,
      'N',
    );
    expect(claims.emailVerified).toBe(false);
  });
});

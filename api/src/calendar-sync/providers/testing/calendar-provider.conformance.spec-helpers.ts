import { CalendarProviderSchema } from '@raid-ledger/contract';
import type {
  CalendarAccountProvider,
  OAuthCredentials,
} from '../calendar-provider.interface';
import { ProviderAuthError } from '../calendar-provider.errors';

/**
 * ROK-1592 (spec §5 "Required tests"): the shared suite every calendar
 * adapter runs. Call it from the adapter's spec with a factory; the factory
 * runs before EACH case and must stage whatever the adapter needs (HTTP
 * fixtures for a real adapter: a code exchange for `validCode`, a 400
 * `invalid_grant` for `invalidCode`, a refresh grant, and a 200 revoke).
 *
 * Account cases run now. Read and write blocks are skipped until their
 * stories add the capability bodies and the fixtures to drive them.
 */
export interface AccountConformanceHarness {
  provider: CalendarAccountProvider;
  /** A code `connect` accepts. */
  validCode: string;
  /** The account `validCode` must resolve to. */
  expectedSubject: string;
  expectedLabel: string | null;
  /** A code the provider rejects as `invalid_grant`. */
  invalidCode: string;
  redirectUri: string;
}

export type ConformanceFactory = () =>
  AccountConformanceHarness | Promise<AccountConformanceHarness>;

type Harness = () => AccountConformanceHarness;

async function connectedCredentials(h: AccountConformanceHarness) {
  const { credentials } = await h.provider.connect({
    code: h.validCode,
    codeVerifier: 'conformance-verifier',
    redirectUri: h.redirectUri,
  });
  const creds: OAuthCredentials = {
    ...credentials,
    refreshToken: credentials.refreshToken ?? 'conformance-refresh-token',
  };
  return creds;
}

function expectUsableGrant(c: { accessToken: string; expiresAt: string }) {
  expect(typeof c.accessToken).toBe('string');
  expect(c.accessToken.length).toBeGreaterThan(0);
  expect(Date.parse(c.expiresAt)).toBeGreaterThan(Date.now());
}

function describeConsentUrl(get: Harness): void {
  it('reports a known provider key and is configured', async () => {
    expect(CalendarProviderSchema.options).toContain(get().provider.key);
    await expect(get().provider.isConfigured()).resolves.toBe(true);
  });

  it('builds a consent URL with state, PKCE S256 and the exact redirect_uri', async () => {
    const h = get();
    const raw = await h.provider.buildAuthUrl({
      state: 'conformance-state',
      codeChallenge: 'conformance-challenge',
      redirectUri: h.redirectUri,
    });
    const url = new URL(raw);
    expect(url.protocol).toBe('https:');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('conformance-state');
    expect(url.searchParams.get('code_challenge')).toBe(
      'conformance-challenge',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(h.redirectUri);
  });
}

function describeCodeExchange(get: Harness): void {
  it('exchanges a valid code for an oauth grant and the account identity', async () => {
    const h = get();
    const result = await h.provider.connect({
      code: h.validCode,
      codeVerifier: 'conformance-verifier',
      redirectUri: h.redirectUri,
    });
    expect(result.accountSubject).toBe(h.expectedSubject);
    expect(result.accountLabel).toBe(h.expectedLabel);
    expect(result.credentials.kind).toBe('oauth');
    expect(Array.isArray(result.credentials.scopes)).toBe(true);
    expectUsableGrant(result.credentials);
  });

  it('rejects an invalid code with ProviderAuthError that does not echo the code', async () => {
    const h = get();
    const err: unknown = await h.provider
      .connect({
        code: h.invalidCode,
        codeVerifier: 'v',
        redirectUri: h.redirectUri,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect(String(err)).not.toContain(h.invalidCode);
  });
}

function describeTokenLifecycle(get: Harness): void {
  it('refresh returns a usable access token and a refresh token', async () => {
    const h = get();
    const next = await h.provider.refresh(await connectedCredentials(h));
    expect(next.kind).toBe('oauth');
    expect(next.refreshToken.length).toBeGreaterThan(0);
    expectUsableGrant(next);
  });

  it('disconnect resolves for a connected grant', async () => {
    const h = get();
    const creds = await connectedCredentials(h);
    await expect(h.provider.disconnect(creds)).resolves.toBeUndefined();
  });
}

function describeDeferredCapabilities(): void {
  // TODO(ROK-1593): un-skip with the read bodies + read fixtures.
  describe.skip('read capability — TODO(ROK-1593)', () => {
    it.todo('listCalendars flags the dedicated calendar as isRaidLedger');
    it.todo('fetchBusy returns [start, end) blocks and drops free events');
    it.todo('fetchBusy parses our copy id into ourId');
    it.todo(
      '401 → ProviderAuthError, 429 → RateLimitError, 5xx → TransientError',
    );
  });
  // TODO(ROK-1596): un-skip with the write bodies + write fixtures.
  describe.skip('write capability — TODO(ROK-1596)', () => {
    it.todo(
      'ensureRaidLedgerCalendar returns the known id when it still exists',
    );
    it.todo('upsertEvent with an existing ref keeps the providerEventId');
    it.todo('a tentative copy is "(Tentative) <title>" and Free');
    it.todo('deleteEvent treats 404/410 as success');
  });
}

/** Register the conformance suite for one adapter. */
export function describeCalendarProviderConformance(
  name: string,
  factory: ConformanceFactory,
): void {
  describe(`${name} — calendar provider conformance`, () => {
    let harness: AccountConformanceHarness;
    beforeEach(async () => {
      harness = await factory();
    });
    const get: Harness = () => harness;
    describe('account capability', () => {
      describeConsentUrl(get);
      describeCodeExchange(get);
      describeTokenLifecycle(get);
    });
    describeDeferredCapabilities();
  });
}

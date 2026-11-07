/**
 * ROK-2129 L2: one Battle.net account-probe run after a verified callback —
 * exchange the code, ask `/profile/user/wow` in four namespaces, check ID
 * parity, and return a keys-only {@link BnetProbeResult}. The user access
 * token lives in this function's locals only (spec D7).
 */
import type {
  BnetProbeIdParity,
  BnetProbeNamespaceResult,
  BnetProbeRegion,
  BnetProbeResult,
} from '@raid-ledger/contract';
import {
  BNET_OAUTH_HOST,
  BNET_PROBE_SCOPE,
  bnetProbeNamespaces,
  exchangeCode,
  fetchUserSummary,
  isPkceRejection,
  type BnetCallResult,
  type BnetFetch,
} from './bnet-account-probe.oauth';
import { runIdParity } from './bnet-account-probe.parity';
import {
  summariseAccountSummary,
  summariseTokenResponse,
} from './bnet-account-probe.summary';

/**
 * Overall budget for one callback's Blizzard calls (MINOR-2): every proxy in
 * front of the api gives `/api/` 60 s (`proxy_read_timeout`), and the 302
 * must reach the browser inside it. Calls still running are aborted.
 */
export const BNET_PROBE_RUN_BUDGET_MS = 40_000;

/** Collaborators a run needs (the service passes real ones). */
export interface BnetProbeRunDeps {
  fetchFn: BnetFetch;
  /** Client-credentials app token for the realmless route (spec D9). */
  getAppToken: (region: BnetProbeRegion) => Promise<string>;
  foreverPrefix: string;
  /** Aborts when the run budget is spent (`AbortSignal.timeout(BUDGET)`). */
  signal: AbortSignal;
}

/** Every call also aborts on the run signal (on top of its own timeout). */
function withRunSignal(fetchFn: BnetFetch, run: AbortSignal): BnetFetch {
  return (url, init) => {
    const signal = init.signal ? AbortSignal.any([init.signal, run]) : run;
    return fetchFn(url, { ...init, signal });
  };
}

/** The verified callback's inputs. */
export interface BnetProbeRunInput {
  at: string;
  region: BnetProbeRegion;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

/** An empty result carrying `error` (no token, no namespaces). */
export function bnetProbeErrorResult(
  at: string,
  region: BnetProbeRegion,
  error: BnetProbeResult['error'],
): BnetProbeResult {
  return {
    at,
    region,
    scopeRequested: BNET_PROBE_SCOPE,
    token: null,
    namespaces: [],
    idParity: null,
    error,
  };
}

/** PKCE first; one retry without `code_verifier` on a PKCE complaint (F3). */
async function exchange(
  deps: BnetProbeRunDeps,
  input: BnetProbeRunInput,
): Promise<{ result: BnetCallResult; pkceAccepted: boolean }> {
  const first = await exchangeCode(deps.fetchFn, input);
  if (!isPkceRejection(first)) return { result: first, pkceAccepted: true };
  const retry = await exchangeCode(deps.fetchFn, {
    ...input,
    codeVerifier: null,
  });
  return { result: retry, pkceAccepted: false };
}

function accessTokenOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token: unknown = Reflect.get(body, 'access_token');
  return typeof token === 'string' && token.length > 0 ? token : null;
}

async function probeNamespaces(
  deps: BnetProbeRunDeps,
  region: BnetProbeRegion,
  accessToken: string,
): Promise<{ results: BnetProbeNamespaceResult[]; foreverBody: unknown }> {
  const results: BnetProbeNamespaceResult[] = [];
  let foreverBody: unknown = null;
  for (const namespace of bnetProbeNamespaces(deps.foreverPrefix, region)) {
    if (deps.signal.aborted) {
      results.push({
        namespace,
        status: null,
        error: 'timeout',
        summary: null,
      });
      continue;
    }
    const res = await fetchUserSummary(deps.fetchFn, {
      region,
      namespace,
      accessToken,
    });
    const ok = res.status === 200;
    if (ok && results.length === 0) foreverBody = res.body;
    const summary = ok ? summariseAccountSummary(res.body) : null;
    results.push({ namespace, status: res.status, error: res.error, summary });
  }
  return { results, foreverBody };
}

async function parity(
  deps: BnetProbeRunDeps,
  region: BnetProbeRegion,
  foreverBody: unknown,
): Promise<BnetProbeIdParity | null> {
  if (foreverBody === null) return null;
  // Budget spent: no token call; runIdParity counts every target as errors.
  const appToken = deps.signal.aborted
    ? ''
    : await deps.getAppToken(region).catch(() => null);
  if (appToken === null) return null;
  return runIdParity(deps.fetchFn, foreverBody, {
    region,
    prefix: deps.foreverPrefix,
    appToken,
    signal: deps.signal,
  });
}

/** Run the probe; never throws for an upstream answer (records it instead). */
export async function runBnetProbe(
  given: BnetProbeRunDeps,
  input: BnetProbeRunInput,
): Promise<BnetProbeResult> {
  const fetchFn = withRunSignal(given.fetchFn, given.signal);
  const deps: BnetProbeRunDeps = { ...given, fetchFn };
  const base = bnetProbeErrorResult(input.at, input.region, null);
  const { result, pkceAccepted } = await exchange(deps, input);
  if (result.status === null) return { ...base, error: 'upstream' };
  const token = summariseTokenResponse(result.body, {
    status: result.status,
    host: BNET_OAUTH_HOST,
    pkceAccepted,
  });
  const accessToken = accessTokenOf(result.body);
  const okStatus = result.status >= 200 && result.status < 300;
  if (!okStatus || accessToken === null) {
    return { ...base, token, error: 'exchange' };
  }
  const probed = await probeNamespaces(deps, input.region, accessToken);
  const idParity = await parity(deps, input.region, probed.foreverBody);
  return { ...base, token, namespaces: probed.results, idParity };
}

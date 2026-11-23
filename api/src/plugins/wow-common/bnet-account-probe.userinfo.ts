/**
 * ROK-2129 F2 (operator ruling 2026-11-07): the OpenID `userinfo` call made
 * with the user token right after the exchange, recorded KEYS ONLY — key
 * names, the JSON type of `id`/`sub`/`battletag`, and whether `id` equals
 * `sub` as strings. The BattleTag, id and sub values stay in this module's
 * locals: they are never logged, stored, returned or sent to Sentry.
 */
import type {
  BnetProbeJsonType,
  BnetProbeUserinfoPath,
  BnetProbeUserinfoSummary,
} from '@raid-ledger/contract';
import {
  BNET_OAUTH_HOST,
  callBnet,
  type BnetCallResult,
  type BnetFetch,
} from './bnet-account-probe.oauth';

/** One userinfo call and what it yielded. */
export interface BnetUserinfoCall {
  path: BnetProbeUserinfoPath;
  result: BnetCallResult;
}

const MAX_KEY_LENGTH = 64;
/** OAuth error codes are a fixed lowercase vocabulary (`invalid_token`). */
const ERROR_CODE = /^[a-z][a-z_]{0,39}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function jsonTypeOf(
  rec: Record<string, unknown>,
  key: string,
): BnetProbeJsonType {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return 'absent';
  const v = rec[key];
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}

function scalar(v: unknown): string | null {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

/** `String(id) === String(sub)` as a boolean; null unless both are scalars. */
function idEqualsSub(rec: Record<string, unknown>): boolean | null {
  const id = scalar(rec.id);
  const sub = scalar(rec.sub);
  return id === null || sub === null ? null : id === sub;
}

function isOk(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

function errorCodeOf(rec: Record<string, unknown>): string | null {
  const code = rec.error;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
}

/**
 * Reduce the userinfo calls to the keys-only summary. The last call's body is
 * described; an error body yields only its key names and OAuth error code.
 */
export function summariseUserinfo(
  calls: BnetUserinfoCall[],
): BnetProbeUserinfoSummary {
  const last = calls[calls.length - 1];
  const rec = last && isRecord(last.result.body) ? last.result.body : {};
  const answered = calls.find((c) => isOk(c.result.status));
  return {
    attempts: calls.map((c) => ({
      path: c.path,
      status: c.result.status,
      error: c.result.error,
    })),
    answeredPath: answered ? answered.path : null,
    keys: Object.keys(rec)
      .filter((k) => k.length <= MAX_KEY_LENGTH)
      .sort(),
    idType: jsonTypeOf(rec, 'id'),
    subType: jsonTypeOf(rec, 'sub'),
    battletagType: jsonTypeOf(rec, 'battletag'),
    idEqualsSub: idEqualsSub(rec),
    errorCode: answered ? null : errorCodeOf(rec),
  };
}

function getUserinfo(
  fetchFn: BnetFetch,
  path: BnetProbeUserinfoPath,
  accessToken: string,
): Promise<BnetCallResult> {
  return callBnet(fetchFn, `https://${BNET_OAUTH_HOST}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * `GET /userinfo` with the user token; on a 404 one retry at
 * `/oauth/userinfo`. Never throws — a failure is recorded in the summary.
 * A spent run budget records a timeout without calling Blizzard.
 */
export async function probeUserinfo(
  fetchFn: BnetFetch,
  accessToken: string,
  signal: AbortSignal,
): Promise<BnetProbeUserinfoSummary> {
  if (signal.aborted) {
    const spent: BnetCallResult = {
      status: null,
      error: 'timeout',
      body: null,
    };
    return summariseUserinfo([{ path: '/userinfo', result: spent }]);
  }
  const first = await getUserinfo(fetchFn, '/userinfo', accessToken);
  const calls: BnetUserinfoCall[] = [{ path: '/userinfo', result: first }];
  if (first.status === 404 && !signal.aborted) {
    const fallback = await getUserinfo(fetchFn, '/oauth/userinfo', accessToken);
    calls.push({ path: '/oauth/userinfo', result: fallback });
  }
  return summariseUserinfo(calls);
}

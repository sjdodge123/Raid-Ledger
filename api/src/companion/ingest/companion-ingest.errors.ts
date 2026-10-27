/**
 * ROK-1956 §9 — the companion ingest error answers. Every body parses as
 * `CompanionIngestErrorSchema` (`{ code, message ≤200, currentVersion?,
 * issues? }`); the HTTP status is fixed per code. Messages are fixed copy —
 * never a token, a header or a payload value.
 */
import { HttpException } from '@nestjs/common';
import {
  COMPANION_INGEST_ISSUES_MAX,
  type CompanionIngestError,
  type CompanionIngestErrorCode,
  type CompanionIngestIssue,
} from '@raid-ledger/contract';
import type { BoundedBodyErrors } from '../../common/bounded-body/bounded-body.reader';

/** §9: the HTTP status of each wire code (both routes). */
export const COMPANION_ERROR_STATUS: Readonly<
  Record<CompanionIngestErrorCode, number>
> = Object.freeze({
  invalid_envelope: 400,
  unknown_contract: 404,
  unknown_contract_version: 404,
  retired_contract_version: 409,
  invalid_payload: 400,
  payload_too_large: 413,
  captured_at_in_future: 400,
  unauthorized: 401,
  rate_limited: 429,
  unsupported_media: 415,
  hash_mismatch: 400,
  invalid_blob: 400,
  blob_ref_mismatch: 409,
  blob_quota_exceeded: 413,
});

const MESSAGE_MAX = 200;
const ISSUE_PATH_MAX = 200;
const ISSUE_CODE_MAX = 40;

/** Optional extras: `currentVersion` (version errors), `issues` (parse errors). */
export interface CompanionErrorExtra {
  currentVersion?: number;
  issues?: readonly CompanionIngestIssue[];
}

/** One companion error answer with its §9 status. */
export function companionError(
  code: CompanionIngestErrorCode,
  message: string,
  extra: CompanionErrorExtra = {},
): HttpException {
  const { currentVersion, issues } = extra;
  const body: CompanionIngestError = {
    code,
    message: message.slice(0, MESSAGE_MAX),
    ...(currentVersion === undefined ? {} : { currentVersion }),
    ...(issues === undefined
      ? {}
      : { issues: issues.slice(0, COMPANION_INGEST_ISSUES_MAX) }),
  };
  return new HttpException(body, COMPANION_ERROR_STATUS[code]);
}

/** A zod-like issue: only its path and code are ever reported. */
interface IssueLike {
  path: ReadonlyArray<PropertyKey>;
  code: string;
}

/** Zod issues → wire issues (path + code only; the received value never leaves). */
export function companionIssues(
  issues: readonly IssueLike[],
): CompanionIngestIssue[] {
  return issues.slice(0, COMPANION_INGEST_ISSUES_MAX).map((i) => ({
    path: i.path.map(String).join('.').slice(0, ISSUE_PATH_MAX),
    code: i.code.slice(0, ISSUE_CODE_MAX),
  }));
}

/** The one 401 for every refusal of the ingest auth guard (no oracle). */
export function companionUnauthorized(): HttpException {
  return companionError('unauthorized', 'Invalid device token or session');
}

/** The bounded reader's companion error factory (Q10: bad gzip → invalid_envelope). */
export const companionBodyErrors: BoundedBodyErrors = Object.freeze({
  tooLarge: () =>
    companionError('payload_too_large', 'Request body is too large'),
  unsupported: (what: 'content-encoding' | 'content-type') =>
    companionError('unsupported_media', `Unsupported ${what}`),
  badGzip: () => companionError('invalid_envelope', 'Body is not valid gzip'),
});

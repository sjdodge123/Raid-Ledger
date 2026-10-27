/**
 * ROK-1956 L2 — every companion error answer parses as
 * `CompanionIngestErrorSchema` and carries the §9 HTTP status.
 */
import { HttpException } from '@nestjs/common';
import {
  COMPANION_INGEST_ISSUES_MAX,
  CompanionIngestErrorSchema,
  type CompanionIngestErrorCode,
} from '@raid-ledger/contract';
import { z } from 'zod';
import {
  COMPANION_ERROR_STATUS,
  companionBodyErrors,
  companionError,
  companionIssues,
} from './companion-ingest.errors';

function bodyOf(err: Error): unknown {
  if (!(err instanceof HttpException)) throw new Error('not an HttpException');
  return err.getResponse();
}

const MATRIX: ReadonlyArray<[CompanionIngestErrorCode, number]> = [
  ['unauthorized', 401],
  ['rate_limited', 429],
  ['unknown_contract', 404],
  ['unknown_contract_version', 404],
  ['retired_contract_version', 409],
  ['payload_too_large', 413],
  ['unsupported_media', 415],
  ['invalid_envelope', 400],
  ['invalid_payload', 400],
  ['captured_at_in_future', 400],
  ['blob_ref_mismatch', 409],
  ['hash_mismatch', 400],
  ['invalid_blob', 400],
  ['blob_quota_exceeded', 413],
];

describe('companion ingest errors (ROK-1956 §9)', () => {
  it.each(MATRIX)('%s answers %i with a schema-valid body', (code, status) => {
    const err = companionError(code, 'x');
    expect(err.getStatus()).toBe(status);
    expect(COMPANION_ERROR_STATUS[code]).toBe(status);
    expect(CompanionIngestErrorSchema.safeParse(bodyOf(err)).success).toBe(
      true,
    );
  });

  it('caps the message at 200 chars and the issues at the max', () => {
    const issues = Array.from({ length: 30 }, () => ({ path: 'a', code: 'b' }));
    const err = companionError('invalid_payload', 'm'.repeat(500), { issues });
    const body = CompanionIngestErrorSchema.parse(bodyOf(err));
    expect(body.message).toHaveLength(200);
    expect(body.issues).toHaveLength(COMPANION_INGEST_ISSUES_MAX);
  });

  it('carries currentVersion only when given', () => {
    const withV = bodyOf(
      companionError('retired_contract_version', 'r', { currentVersion: 2 }),
    );
    expect(withV).toMatchObject({ currentVersion: 2 });
    expect(bodyOf(companionError('unknown_contract', 'u'))).not.toHaveProperty(
      'currentVersion',
    );
  });

  it('maps zod issues to path + code only (never the received value)', () => {
    const r = z
      .object({ a: z.object({ b: z.number() }) })
      .safeParse({ a: { b: 'SECRET' } });
    if (r.success) throw new Error('expected a failure');
    const issues = companionIssues(r.error.issues);
    expect(issues).toEqual([{ path: 'a.b', code: 'invalid_type' }]);
    expect(JSON.stringify(issues)).not.toContain('SECRET');
  });

  it('the bounded-reader factory maps to 413 / 415 / 400 invalid_envelope (Q10)', () => {
    expect(bodyOf(companionBodyErrors.tooLarge())).toMatchObject({
      code: 'payload_too_large',
    });
    expect(
      bodyOf(companionBodyErrors.unsupported('content-encoding')),
    ).toMatchObject({ code: 'unsupported_media' });
    expect(bodyOf(companionBodyErrors.badGzip())).toMatchObject({
      code: 'invalid_envelope',
    });
  });
});

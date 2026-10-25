/**
 * ROK-1956 U-6 (step order + lookup mapping) and U-7 (clock rule) for the
 * pure messages-route steps. Synthetic contracts come from an injected table.
 */
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type {
  CompanionContractTable,
  CompanionContractVersionSpec,
} from '@raid-ledger/contract';
import type { CompanionContractHandler } from './companion-handler.registry';
import {
  assertContractParam,
  assertNotFromFuture,
  latestMarkerOf,
  validateCompanionMessage,
  type CompanionValidateDeps,
} from './companion-ingest.steps';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function messageSchema(contract: string, version: number): z.ZodType {
  return z
    .object({
      envelopeVersion: z.literal(1),
      contract: z.literal(contract),
      contractVersion: z.literal(version),
      capturedAt: z.string(),
      appVersion: z.string(),
      collectorVersion: z.string(),
      payload: z.object({ n: z.number().int() }).strict(),
    })
    .strict();
}

function spec(
  contract: string,
  version: number,
  status: CompanionContractVersionSpec['status'],
  maxBytes = 4096,
): CompanionContractVersionSpec {
  const schema = messageSchema(contract, version);
  return { schema, maxBytes, blobSlots: [], status };
}

const TABLE: CompanionContractTable = {
  'test-msg': { 1: spec('test-msg', 1, 'current') },
  'test-small': { 1: spec('test-small', 1, 'current', 10) },
  'test-retired': {
    1: spec('test-retired', 1, 'retired'),
    2: spec('test-retired', 2, 'current'),
  },
};

const handler: CompanionContractHandler = {
  contract: 'test-msg',
  versions: [1],
  handle: () => Promise.resolve(),
};

function deps(over: Partial<CompanionValidateDeps> = {}): CompanionValidateDeps {
  return { table: TABLE, resolve: () => handler, now: NOW, ...over };
}

function body(over: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      envelopeVersion: 1,
      contract: 'test-msg',
      contractVersion: 1,
      capturedAt: '2026-10-25T11:59:00.000Z',
      appVersion: '1.0.0',
      collectorVersion: '1.0.0',
      payload: { n: 1 },
      ...over,
    }),
  );
}

/** The companion error body + status a step threw. */
function failure(fn: () => unknown): { status: number; body: unknown } {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
  throw new Error('expected the step to throw');
}

const run = (b: Buffer, d = deps(), param = 'test-msg') => () =>
  validateCompanionMessage(param, b, d);

describe('companion ingest steps — U-6 order + mapping', () => {
  it('accepts a valid message and returns the parsed message', () => {
    const out = validateCompanionMessage('test-msg', body(), deps());
    expect(out).toMatchObject({ contract: 'test-msg', version: 1, handler });
    expect(out.message).toMatchObject({ payload: { n: 1 } });
  });

  it('a body failing both envelope and payload reports invalid_envelope', () => {
    const b = body({ payload: { n: 'x' }, envelopeVersion: 2 });
    expect(failure(run(b))).toMatchObject({
      status: 400,
      body: { code: 'invalid_envelope', issues: [{ path: 'envelopeVersion' }] },
    });
  });

  it('non-JSON and invalid UTF-8 bodies are invalid_envelope', () => {
    const bad = [Buffer.from('{nope'), Buffer.from([0x7b, 0xff, 0x7d])];
    for (const b of bad) {
      expect(failure(run(b)).body).toMatchObject({ code: 'invalid_envelope' });
    }
  });

  it('a path/body contract mismatch is invalid_envelope', () => {
    const f = failure(run(body(), deps(), 'test-other'));
    expect(f).toMatchObject({ status: 400, body: { code: 'invalid_envelope' } });
  });

  it('maps the lookup kinds to the §9 codes + currentVersion', () => {
    const unknown = failure(run(body({ contract: 'nope-x' }), deps(), 'nope-x'));
    expect(unknown).toMatchObject({ status: 404, body: { code: 'unknown_contract' } });
    const r = (v: number) =>
      run(body({ contract: 'test-retired', contractVersion: v }), deps(), 'test-retired');
    expect(failure(r(3))).toMatchObject({
      status: 404,
      body: { code: 'unknown_contract_version', currentVersion: 2 },
    });
    expect(failure(r(1))).toMatchObject({
      status: 409,
      body: { code: 'retired_contract_version', currentVersion: 2 },
    });
  });

  it('a lookup failure wins over a missing handler; no handler → unknown_contract', () => {
    const none = deps({ resolve: () => null });
    expect(failure(run(body(), none))).toMatchObject({
      status: 404,
      body: { code: 'unknown_contract' },
    });
    const retired = body({ contract: 'test-retired', contractVersion: 1 });
    expect(failure(run(retired, none, 'test-retired')).body).toMatchObject({
      code: 'retired_contract_version',
    });
  });

  it('the per-contract cap applies after lookup and before the payload schema', () => {
    const b = body({ contract: 'test-small', payload: { n: 'x' } });
    expect(failure(run(b, deps(), 'test-small'))).toMatchObject({
      status: 413,
      body: { code: 'payload_too_large' },
    });
  });

  it('a valid envelope with a bad payload is invalid_payload with path + code only', () => {
    const f = failure(run(body({ payload: { n: 'secret-value' } })));
    expect(f).toMatchObject({
      status: 400,
      body: { code: 'invalid_payload', issues: [{ path: 'payload.n', code: 'invalid_type' }] },
    });
    expect(JSON.stringify(f.body)).not.toContain('secret-value');
  });

  it('payload errors report before the clock rule (D-10)', () => {
    const b = body({ payload: { n: 'x' }, capturedAt: '2027-01-01T00:00:00.000Z' });
    expect(failure(run(b)).body).toMatchObject({ code: 'invalid_payload' });
  });

  it('a malformed :contract param is 404 unknown_contract', () => {
    for (const raw of ['', 'A', '__proto__', 'x'.repeat(41), 'bg3_save']) {
      expect(failure(() => assertContractParam(raw))).toMatchObject({
        status: 404,
        body: { code: 'unknown_contract' },
      });
    }
    expect(assertContractParam('bg3-save')).toBe('bg3-save');
  });
});

describe('companion ingest steps — U-7 clock rule', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it('accepts capturedAt = now + 300 000 ms', () => {
    expect(() => assertNotFromFuture(at(300_000), NOW)).not.toThrow();
  });

  it('rejects capturedAt = now + 300 001 ms as captured_at_in_future', () => {
    expect(failure(() => assertNotFromFuture(at(300_001), NOW))).toMatchObject({
      status: 400,
      body: { code: 'captured_at_in_future' },
    });
  });

  it('the pipeline applies the injected clock', () => {
    const b = body({ capturedAt: at(300_001) });
    expect(failure(run(b)).body).toMatchObject({ code: 'captured_at_in_future' });
  });
});

describe('latestMarkerOf', () => {
  const withMarker = (key: string, when: Date): CompanionContractHandler => ({
    ...handler,
    latestWins: () => ({ key, at: when }),
  });

  it('is null without latestWins and passes a valid marker through', () => {
    expect(latestMarkerOf(handler, {})).toBeNull();
    expect(latestMarkerOf(withMarker('k', NOW), {})).toEqual({ key: 'k', at: NOW });
  });

  it('a key over 128 chars, an empty key or an invalid date is a 500-class Error', () => {
    const bad = [
      withMarker('k'.repeat(129), NOW),
      withMarker('', NOW),
      withMarker('k', new Date(Number.NaN)),
    ];
    for (const h of bad) {
      expect(() => latestMarkerOf(h, {})).toThrow(/latest-wins/);
      expect(() => latestMarkerOf(h, {})).not.toThrow(HttpException);
    }
  });
});

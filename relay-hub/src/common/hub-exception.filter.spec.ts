import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { HubErrorSchema } from '@raid-ledger/contract';
import { hubError } from './hub-errors';
import { HubExceptionFilter } from './hub-exception.filter';

/** A minimal HTTP host capturing what the filter sends. */
function fakeHost() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

describe('HubExceptionFilter (ROK-1671 L7)', () => {
  const filter = new HubExceptionFilter();

  it('passes a hubError through with its status and code', () => {
    const { host, sent } = fakeHost();
    filter.catch(hubError(403, 'revoked'), host);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: 'revoked' });
  });

  it('keeps a hubError message', () => {
    const { host, sent } = fakeHost();
    filter.catch(hubError(426, 'schema_unsupported', 'use 1'), host);
    expect(sent).toEqual({
      status: 426,
      body: { error: 'schema_unsupported', message: 'use 1' },
    });
  });

  it('maps a plain Nest HttpException to error unknown, keeping the status', () => {
    const { host, sent } = fakeHost();
    filter.catch(new NotFoundException('Cannot POST /x'), host);
    expect(sent.status).toBe(404);
    expect(HubErrorSchema.parse(sent.body)).toEqual({ error: 'unknown' });
  });

  it('maps a non-HTTP error to 500 unknown without leaking its message', () => {
    const { host, sent } = fakeHost();
    filter.catch(new Error('password=hunter2'), host);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: 'unknown' });
  });

  it("keeps a controller's deliberate non-error body (health /ready 503)", () => {
    const { host, sent } = fakeHost();
    filter.catch(new HttpException({ status: 'unavailable' }, 503), host);
    expect(sent).toEqual({ status: 503, body: { status: 'unavailable' } });
  });

  it("maps Nest's own 400 (e.g. malformed JSON) to validation_failed", () => {
    const { host, sent } = fakeHost();
    filter.catch(new BadRequestException('Unexpected token } in JSON'), host);
    expect(sent).toEqual({ status: 400, body: { error: 'validation_failed' } });
  });
});

describe('HubExceptionFilter non-Nest http-errors (ROK-1671)', () => {
  const filter = new HubExceptionFilter();

  it.each([
    [413, 'request entity too large', 'unknown'],
    [415, 'unsupported charset "UTF-7"', 'unknown'],
    [400, 'request aborted', 'validation_failed'],
  ])(
    'keeps a body-parser http-error %i and normalises its body',
    (status, message, code) => {
      const { host, sent } = fakeHost();
      const err = Object.assign(new Error(message), {
        status,
        statusCode: status,
        expose: true,
      });
      filter.catch(err, host);
      expect(sent).toEqual({ status, body: { error: code } });
    },
  );

  it.each([
    ['a 5xx statusCode', { statusCode: 503 }],
    ['a non-numeric statusCode', { statusCode: '413' }],
    ['an out-of-range statusCode', { statusCode: 99 }],
  ])('still answers 500 for an error with %s', (_label, extra) => {
    const { host, sent } = fakeHost();
    filter.catch(Object.assign(new Error('boom'), extra), host);
    expect(sent).toEqual({ status: 500, body: { error: 'unknown' } });
  });
});

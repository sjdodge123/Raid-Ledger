/**
 * ROK-1597 T6 (spec §3.5): every Graph failure maps to the exact shared
 * error class, with a safe snake-cased reason and the Retry-After wait.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as microsoftHttp from './microsoft-http';
import {
  assertGraphOk,
  graphErrorCode,
  graphRequest,
  isGraphAccessDenied,
  mapGraphError,
  type GraphErrorContext,
} from './microsoft-graph-errors.helpers';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as unknown;

const res = (
  status: number,
  json: unknown,
  retryAfter: string | null = null,
) => ({
  status,
  json,
  retryAfter,
});

afterEach(() => jest.restoreAllMocks());

interface ErrorCase {
  name: string;
  status: number;
  json: unknown;
  ctx: GraphErrorContext;
  retryAfter?: string;
  cls: new (...args: never[]) => Error;
  reason: string;
}

const ERROR_CASES: ErrorCase[] = [
  {
    name: '401 token',
    status: 401,
    json: fixture('error-401'),
    ctx: 'read',
    cls: ProviderAuthError,
    reason: 'invalid_authentication_token',
  },
  {
    name: '403 read',
    status: 403,
    json: fixture('error-403'),
    ctx: 'read',
    cls: ProviderRequestError,
    reason: 'error_access_denied',
  },
  {
    name: '403 write',
    status: 403,
    json: fixture('error-403'),
    ctx: 'write',
    cls: ProviderAuthError,
    reason: 'scope',
  },
  {
    name: '403 RequestDenied on read',
    status: 403,
    json: { error: { code: 'Authorization_RequestDenied' } },
    ctx: 'read',
    cls: ProviderAuthError,
    reason: 'scope',
  },
  {
    name: '404',
    status: 404,
    json: fixture('error-404'),
    ctx: 'write',
    cls: NotFoundError,
    reason: 'error_item_not_found',
  },
  {
    name: '410',
    status: 410,
    json: null,
    ctx: 'read',
    cls: NotFoundError,
    reason: 'http_410',
  },
  {
    name: '429',
    status: 429,
    json: fixture('error-429'),
    ctx: 'read',
    retryAfter: '7',
    cls: RateLimitError,
    reason: 'application_throttled',
  },
  {
    name: '503 + Retry-After',
    status: 503,
    json: null,
    ctx: 'write',
    retryAfter: '3',
    cls: RateLimitError,
    reason: 'http_503',
  },
  {
    name: '503 bare',
    status: 503,
    json: null,
    ctx: 'read',
    cls: TransientError,
    reason: 'http_503',
  },
  {
    name: '500',
    status: 500,
    json: null,
    ctx: 'read',
    cls: TransientError,
    reason: 'http_500',
  },
  {
    name: '400',
    status: 400,
    json: { error: { code: 'ErrorInvalidRequest' } },
    ctx: 'write',
    cls: ProviderRequestError,
    reason: 'error_invalid_request',
  },
];

describe('mapGraphError', () => {
  it.each(ERROR_CASES)('$name → $cls.name ($reason)', (c) => {
    const err = mapGraphError(
      res(c.status, c.json, c.retryAfter ?? null),
      c.ctx,
    );
    expect(err).toBeInstanceOf(c.cls);
    expect(err.reason).toBe(c.reason);
  });

  it('carries Retry-After seconds as milliseconds on a 429 and a 503', () => {
    const r429 = mapGraphError(res(429, null, '7'), 'read');
    const r503 = mapGraphError(res(503, null, '3'), 'read');
    expect(r429).toBeInstanceOf(RateLimitError);
    expect(r503).toBeInstanceOf(RateLimitError);
    expect(r429 instanceof RateLimitError && r429.retryAfterMs).toBe(7000);
    expect(r503 instanceof RateLimitError && r503.retryAfterMs).toBe(3000);
  });

  it('never puts the Graph message in the error text', () => {
    const err = mapGraphError(res(401, fixture('error-401')), 'read');
    expect(String(err)).not.toContain('expired');
  });
});

describe('graphErrorCode / isGraphAccessDenied / assertGraphOk', () => {
  it('reads error.code only when it is a plain identifier', () => {
    expect(graphErrorCode(fixture('error-404'))).toBe('ErrorItemNotFound');
    expect(graphErrorCode({ error: { code: 'bad code <x>' } })).toBeNull();
    expect(graphErrorCode('not json')).toBeNull();
  });

  it('flags only a 403 ErrorAccessDenied as an unreadable calendar', () => {
    expect(isGraphAccessDenied(res(403, fixture('error-403')))).toBe(true);
    expect(isGraphAccessDenied(res(401, fixture('error-403')))).toBe(false);
    expect(isGraphAccessDenied(res(403, null))).toBe(false);
  });

  it('passes a 2xx and throws the mapped error otherwise', () => {
    expect(() => assertGraphOk(res(204, null), 'write')).not.toThrow();
    expect(() => assertGraphOk(res(404, null), 'write')).toThrow(NotFoundError);
  });
});

describe('graphRequest', () => {
  it.each([
    {
      thrown: Object.assign(new Error('t'), { name: 'TimeoutError' }),
      reason: 'timeout',
    },
    { thrown: new TypeError('fetch failed'), reason: 'network' },
  ])('maps a fetch rejection to TransientError($reason)', async (c) => {
    jest
      .spyOn(microsoftHttp, 'microsoftJsonRequest')
      .mockRejectedValue(c.thrown);
    const err: unknown = await graphRequest('GET', 'https://g/x', 'tok').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TransientError);
    expect(err instanceof TransientError && err.reason).toBe(c.reason);
  });

  it('forwards method, url, token, body and Prefer to the seam', async () => {
    const spy = jest
      .spyOn(microsoftHttp, 'microsoftJsonRequest')
      .mockResolvedValue(res(200, {}));
    await graphRequest(
      'PATCH',
      'https://g/y',
      'tok',
      { a: 1 },
      { prefer: ['p1'] },
    );
    expect(spy).toHaveBeenCalledWith(
      'PATCH',
      'https://g/y',
      'tok',
      { a: 1 },
      { prefer: ['p1'] },
    );
  });
});

describe('microsoftHttp.jsonHeaders', () => {
  it('joins Prefer values into one header and sets JSON content type only with a body', () => {
    expect(microsoftHttp.jsonHeaders('tok', true, ['a="1"', 'b="2"'])).toEqual({
      Authorization: 'Bearer tok',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'a="1", b="2"',
    });
    expect(microsoftHttp.jsonHeaders('tok', false)).toEqual({
      Authorization: 'Bearer tok',
      Accept: 'application/json',
    });
  });
});

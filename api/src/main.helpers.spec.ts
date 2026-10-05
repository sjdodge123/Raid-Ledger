import {
  validateCorsConfig,
  buildHelmetOptions,
  getLogLevels,
  parseLogLevel,
  buildLoggerSelfTest,
  LOGGER_SELF_TEST_WARN_SENTINEL,
  LOGGER_SELF_TEST_ERROR_SENTINEL,
} from './main.helpers';
import { applyCorsPolicy } from './cors/cors-auto-policy';

function describeValidateCorsConfig() {
  it('throws when production has no CORS_ORIGIN', () => {
    expect(() => validateCorsConfig(true, undefined)).toThrow(
      'CORS_ORIGIN environment variable must be set in production',
    );
  });

  it('throws when production uses wildcard', () => {
    expect(() => validateCorsConfig(true, '*')).toThrow(
      'CORS_ORIGIN=* is not allowed in production',
    );
  });

  it('notes the same-origin check when production uses auto (ROK-1732)', () => {
    const logger = { warn: jest.fn() };
    validateCorsConfig(true, 'auto', logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toContain('CORS_ORIGIN=auto checks that a request Origin');
    expect(message).toContain('[cors-auto] mode line');
    expect(message).not.toContain('allows all origins');
  });

  it('does not warn for auto in development', () => {
    const logger = { warn: jest.fn() };
    validateCorsConfig(false, 'auto', logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes for specific origin in production', () => {
    const logger = { warn: jest.fn() };
    expect(() =>
      validateCorsConfig(true, 'https://app.example.com', logger),
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes for any value in development', () => {
    expect(() => validateCorsConfig(false, undefined)).not.toThrow();
    expect(() => validateCorsConfig(false, '*')).not.toThrow();
  });
}

function describeBuildHelmetOptions() {
  it('includes cross-origin resource policy', () => {
    const opts = buildHelmetOptions();
    expect(opts.crossOriginResourcePolicy).toEqual({
      policy: 'cross-origin',
    });
  });

  it('sets restrictive CSP defaultSrc', () => {
    const opts = buildHelmetOptions();
    const directives = opts.contentSecurityPolicy.directives;
    expect(directives.defaultSrc).toEqual(["'none'"]);
  });

  it('sets frameAncestors to none', () => {
    const opts = buildHelmetOptions();
    const directives = opts.contentSecurityPolicy.directives;
    expect(directives.frameAncestors).toEqual(["'none'"]);
  });
}

function describeParseLogLevel() {
  it('returns null for undefined / empty input', () => {
    expect(parseLogLevel(undefined)).toBeNull();
    expect(parseLogLevel('')).toBeNull();
  });

  it('accepts each valid level', () => {
    expect(parseLogLevel('error')).toBe('error');
    expect(parseLogLevel('warn')).toBe('warn');
    expect(parseLogLevel('log')).toBe('log');
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('verbose')).toBe('verbose');
  });

  it('normalizes case and whitespace', () => {
    expect(parseLogLevel('  WARN ')).toBe('warn');
    expect(parseLogLevel('Debug')).toBe('debug');
  });

  it('rejects unknown values', () => {
    expect(parseLogLevel('banana')).toBeNull();
  });
}

function describeGetLogLevels() {
  it('defaults to error/warn/log when nothing is set', () => {
    const consoleLike = { warn: jest.fn() };
    expect(getLogLevels({}, consoleLike)).toEqual(['error', 'warn', 'log']);
    expect(consoleLike.warn).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=warn keeps error/warn only', () => {
    expect(getLogLevels({ LOG_LEVEL: 'warn' })).toEqual(['error', 'warn']);
  });

  it('LOG_LEVEL=error keeps only error', () => {
    expect(getLogLevels({ LOG_LEVEL: 'error' })).toEqual(['error']);
  });

  it('LOG_LEVEL=debug includes debug + everything more severe', () => {
    expect(getLogLevels({ LOG_LEVEL: 'debug' })).toEqual([
      'error',
      'warn',
      'log',
      'debug',
    ]);
  });

  it('LOG_LEVEL=verbose includes every level', () => {
    expect(getLogLevels({ LOG_LEVEL: 'verbose' })).toEqual([
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('legacy bridge: DEBUG=true upgrades threshold to debug', () => {
    expect(getLogLevels({ DEBUG: 'true' })).toEqual([
      'error',
      'warn',
      'log',
      'debug',
    ]);
  });

  it('legacy bridge does not fire when DEBUG is anything other than "true"', () => {
    expect(getLogLevels({ DEBUG: 'false' })).not.toContain('debug');
    expect(getLogLevels({ DEBUG: '1' })).not.toContain('debug');
  });

  it('LOG_LEVEL takes precedence over DEBUG=true', () => {
    expect(getLogLevels({ LOG_LEVEL: 'warn', DEBUG: 'true' })).toEqual([
      'error',
      'warn',
    ]);
  });

  it('falls back to "log" and warns once when LOG_LEVEL is invalid', () => {
    const consoleLike = { warn: jest.fn() };
    const levels = getLogLevels({ LOG_LEVEL: 'banana' }, consoleLike);
    expect(levels).toEqual(['error', 'warn', 'log']);
    expect(consoleLike.warn).toHaveBeenCalledTimes(1);
    expect(consoleLike.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid LOG_LEVEL="banana"'),
    );
  });

  it('NODE_ENV=production keeps "log" threshold', () => {
    expect(getLogLevels({ NODE_ENV: 'production' })).toEqual([
      'error',
      'warn',
      'log',
    ]);
  });

  it('NODE_ENV=development upgrades threshold to debug', () => {
    expect(getLogLevels({ NODE_ENV: 'development' })).toContain('debug');
  });

  it('explicit LOG_LEVEL beats NODE_ENV=development', () => {
    expect(
      getLogLevels({ NODE_ENV: 'development', LOG_LEVEL: 'warn' }),
    ).toEqual(['error', 'warn']);
  });
}

function describeBuildLoggerSelfTest() {
  it('returns a function that logs one warn and one error sentinel', () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const run = buildLoggerSelfTest(logger);
    run();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(LOGGER_SELF_TEST_WARN_SENTINEL);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(LOGGER_SELF_TEST_ERROR_SENTINEL);
  });
}

type Delegate = (req: object, cb: (e: Error | null, o: object) => void) => void;
type Gate = (req: object, res: object, next: () => void) => void;

/** ROK-1732: applyCorsPolicy against a fake app recording what it registers. */
function wireFakeApp(autoMode: string) {
  const calls: Array<[string, unknown]> = [];
  const app = {
    use: (fn: unknown) => calls.push(['use', fn]),
    enableCors: (opts: unknown) => calls.push(['enableCors', opts]),
  };
  const env = { corsOrigin: 'auto', autoMode };
  const logger = { warn: jest.fn(), log: jest.fn() };
  applyCorsPolicy(app, { isProduction: true, getEnv: () => env, logger });
  const gate = calls[0]?.[1] as Gate;
  const delegate = calls[1]?.[1] as Delegate;
  const optionsFor = (req: object) =>
    new Promise<Record<string, unknown>>((resolve) =>
      delegate(req, (_e, o) => resolve(o as Record<string, unknown>)),
    );
  return { calls, gate, optionsFor };
}

function siblingRequest() {
  return {
    headers: { origin: 'https://slot-1.example.net', host: 'raid.example.net' },
    method: 'POST',
    path: '/auth/refresh',
  };
}

function fakeResponse() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function describeApplyCorsPolicyWiring() {
  it('registers the gate BEFORE cors, and cors in delegate form', () => {
    const { calls } = wireFakeApp('report');
    expect(calls.map(([kind, arg]) => [kind, typeof arg])).toEqual([
      ['use', 'function'],
      ['enableCors', 'function'],
    ]);
  });

  it('report: passes a sibling Origin through and reflects it (as auto did)', async () => {
    const { gate, optionsFor } = wireFakeApp('report');
    const req = siblingRequest();
    const next = jest.fn();
    gate(req, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(await optionsFor(req)).toEqual({
      origin: true,
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
  });

  it('enforce: 403s a sibling Origin without calling next', async () => {
    const { gate, optionsFor } = wireFakeApp('enforce');
    const req = siblingRequest();
    const res = fakeResponse();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 403,
      message: 'Origin not allowed',
    });
    expect((await optionsFor(req)).origin).toBe(false);
  });

  it('never reflects an Origin for a request the gate did not pass', async () => {
    const { optionsFor } = wireFakeApp('report');
    expect(await optionsFor(siblingRequest())).toEqual({
      origin: false,
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
  });
}

describe('main.helpers', () => {
  describe('validateCorsConfig', () => describeValidateCorsConfig());
  describe('applyCorsPolicy wiring (ROK-1732)', () =>
    describeApplyCorsPolicyWiring());
  describe('buildHelmetOptions', () => describeBuildHelmetOptions());
  describe('parseLogLevel', () => describeParseLogLevel());
  describe('getLogLevels', () => describeGetLogLevels());
  describe('buildLoggerSelfTest', () => describeBuildLoggerSelfTest());
});

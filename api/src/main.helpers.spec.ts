import {
  validateCorsConfig,
  buildCorsOriginFn,
  buildHelmetOptions,
  getLogLevels,
  parseLogLevel,
  buildLoggerSelfTest,
  LOGGER_SELF_TEST_WARN_SENTINEL,
  LOGGER_SELF_TEST_ERROR_SENTINEL,
} from './main.helpers';

type CorsCallback = (err: Error | null, allow?: boolean) => void;

function callOriginFn(
  fn: (origin: string | undefined, cb: CorsCallback) => void,
  origin: string | undefined,
): Promise<{ err: Error | null; allow?: boolean }> {
  return new Promise((resolve) => {
    fn(origin, (err, allow) => resolve({ err, allow }));
  });
}

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

  it('warns when production uses auto', () => {
    const logger = { warn: jest.fn() };
    validateCorsConfig(true, 'auto', logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('CORS_ORIGIN=auto allows all origins'),
    );
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

function describeBuildCorsOriginFn() {
  it('allows same-origin (undefined) requests', async () => {
    const fn = buildCorsOriginFn(true, 'https://a.com', false);
    const result = await callOriginFn(fn, undefined);
    expect(result.err).toBeNull();
    expect(result.allow).toBe(true);
  });

  it('auto mode allows any origin', async () => {
    const fn = buildCorsOriginFn(true, 'auto', true);
    const result = await callOriginFn(fn, 'https://evil.com');
    expect(result.err).toBeNull();
    expect(result.allow).toBe(true);
  });

  it('rejects unknown origin in production', async () => {
    const fn = buildCorsOriginFn(true, 'https://app.com', false);
    const result = await callOriginFn(fn, 'https://evil.com');
    expect(result.err).toBeInstanceOf(Error);
    expect(result.err?.message).toBe('Not allowed by CORS');
    expect(result.allow).toBe(false);
  });

  it('allows matching origin in production', async () => {
    const fn = buildCorsOriginFn(true, 'https://app.com', false);
    const result = await callOriginFn(fn, 'https://app.com');
    expect(result.err).toBeNull();
    expect(result.allow).toBe(true);
  });

  it('allows localhost variants in development', async () => {
    const fn = buildCorsOriginFn(false, 'https://a.com', false);
    const ports = [
      'http://localhost',
      'http://localhost:80',
      'http://localhost:5173',
      'http://localhost:5174',
    ];
    for (const port of ports) {
      const result = await callOriginFn(fn, port);
      expect(result.err).toBeNull();
      expect(result.allow).toBe(true);
    }
  });

  it('rejects localhost in production', async () => {
    const fn = buildCorsOriginFn(true, 'https://app.com', false);
    const result = await callOriginFn(fn, 'http://localhost:5173');
    expect(result.err).toBeInstanceOf(Error);
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

describe('main.helpers', () => {
  describe('validateCorsConfig', () => describeValidateCorsConfig());
  describe('buildCorsOriginFn', () => describeBuildCorsOriginFn());
  describe('buildHelmetOptions', () => describeBuildHelmetOptions());
  describe('parseLogLevel', () => describeParseLogLevel());
  describe('getLogLevels', () => describeGetLogLevels());
  describe('buildLoggerSelfTest', () => describeBuildLoggerSelfTest());
});

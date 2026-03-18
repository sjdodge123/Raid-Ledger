import {
  validateCorsConfig,
  buildCorsOriginFn,
  buildHelmetOptions,
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

describe('main.helpers', () => {
  describe('validateCorsConfig', () => describeValidateCorsConfig());
  describe('buildCorsOriginFn', () => describeBuildCorsOriginFn());
  describe('buildHelmetOptions', () => describeBuildHelmetOptions());
});

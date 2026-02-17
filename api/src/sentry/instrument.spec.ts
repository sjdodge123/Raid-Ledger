/**
 * Tests for Sentry instrumentation configuration (ROK-366).
 * Verifies that pg_catalog spans are filtered out to suppress false-positive N+1 noise.
 */

function loadInstrument(env: Record<string, string | undefined> = {}): {
  sentryInitMock: jest.MockedFunction<(options?: Record<string, unknown>) => void>;
} {
  // Save and restore env
  const saved: Record<string, string | undefined> = {};
  for (const key of ['NODE_ENV', 'DISABLE_TELEMETRY']) {
    saved[key] = process.env[key];
    if (key in env) {
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    } else {
      delete process.env[key];
    }
  }

  jest.resetModules();

  // Register the mock inside resetModules so it is fresh
  jest.mock('@sentry/nestjs', () => ({
    init: jest.fn(),
  }));

  // Re-require to trigger module-level side effects
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./instrument');

  // Retrieve the fresh mock
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sentry = require('@sentry/nestjs') as {
    init: jest.MockedFunction<(options?: Record<string, unknown>) => void>;
  };

  // Restore env
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }

  return { sentryInitMock: sentry.init };
}

describe('Sentry instrument.ts', () => {
  afterEach(() => {
    jest.resetModules();
  });

  describe('when telemetry is enabled (default)', () => {
    let sentryInitMock: jest.MockedFunction<(options?: Record<string, unknown>) => void>;

    beforeEach(() => {
      ({ sentryInitMock } = loadInstrument({ DISABLE_TELEMETRY: undefined }));
    });

    it('calls Sentry.init', () => {
      expect(sentryInitMock).toHaveBeenCalledTimes(1);
    });

    it('includes ignoreSpans in the Sentry config', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config).toHaveProperty('ignoreSpans');
    });

    it('ignoreSpans contains a regex matching pg_catalog queries', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];

      expect(Array.isArray(ignoreSpans)).toBe(true);
      expect(ignoreSpans.length).toBeGreaterThan(0);

      const regex = ignoreSpans[0];
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('pg_catalog.pg_type')).toBe(true);
    });

    it('ignoreSpans regex matches various pg_catalog span names', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];
      const regex = ignoreSpans[0];

      // All of these are typical Postgres driver type introspection spans
      expect(regex.test('pg_catalog.pg_type')).toBe(true);
      expect(regex.test('SELECT * FROM pg_catalog.pg_namespace')).toBe(true);
      expect(regex.test('pg_catalog')).toBe(true);
    });

    it('ignoreSpans regex does NOT match unrelated span names', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];
      const regex = ignoreSpans[0];

      expect(regex.test('SELECT * FROM users')).toBe(false);
      expect(regex.test('INSERT INTO events')).toBe(false);
      expect(regex.test('db.query')).toBe(false);
      expect(regex.test('http.request')).toBe(false);
    });

    it('includes a beforeSend handler that suppresses ThrottlerException events', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const beforeSend = config['beforeSend'] as (
        event: Record<string, unknown>,
      ) => Record<string, unknown> | null;

      expect(typeof beforeSend).toBe('function');

      const throttlerEvent = {
        exception: { values: [{ type: 'ThrottlerException' }] },
      };
      expect(beforeSend(throttlerEvent)).toBeNull();
    });

    it('does not suppress non-ThrottlerException events via beforeSend', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const beforeSend = config['beforeSend'] as (
        event: Record<string, unknown>,
      ) => Record<string, unknown> | null;

      const normalEvent = {
        exception: { values: [{ type: 'Error' }] },
      };
      expect(beforeSend(normalEvent)).toBe(normalEvent);
    });

    it('sets tracesSampleRate to 1.0 in non-production environment', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['tracesSampleRate']).toBe(1.0);
    });

    it('sets environment tag to development in non-production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['environment']).toBe('development');
    });
  });

  describe('when NODE_ENV=production', () => {
    let sentryInitMock: jest.MockedFunction<(options?: Record<string, unknown>) => void>;

    beforeEach(() => {
      ({ sentryInitMock } = loadInstrument({ NODE_ENV: 'production', DISABLE_TELEMETRY: undefined }));
    });

    it('sets tracesSampleRate to 0.1 in production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['tracesSampleRate']).toBe(0.1);
    });

    it('sets environment tag to production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['environment']).toBe('production');
    });

    it('still includes ignoreSpans with pg_catalog filter in production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];

      expect(Array.isArray(ignoreSpans)).toBe(true);
      const regex = ignoreSpans[0];
      expect(regex.test('pg_catalog.pg_type')).toBe(true);
    });
  });

  describe('when DISABLE_TELEMETRY=true', () => {
    let sentryInitMock: jest.MockedFunction<(options?: Record<string, unknown>) => void>;

    beforeEach(() => {
      ({ sentryInitMock } = loadInstrument({ DISABLE_TELEMETRY: 'true' }));
    });

    it('does NOT call Sentry.init', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });

  describe('when DISABLE_TELEMETRY is not set', () => {
    let sentryInitMock: jest.MockedFunction<(options?: Record<string, unknown>) => void>;

    beforeEach(() => {
      ({ sentryInitMock } = loadInstrument({ DISABLE_TELEMETRY: undefined }));
    });

    it('calls Sentry.init (telemetry is on by default)', () => {
      expect(sentryInitMock).toHaveBeenCalledTimes(1);
    });
  });
});

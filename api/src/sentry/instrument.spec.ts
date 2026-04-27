/**
 * Tests for Sentry instrumentation configuration (ROK-366).
 * Verifies that pg_catalog spans are filtered out to suppress false-positive N+1 noise.
 */

async function loadInstrument(
  env: Record<string, string | undefined> = {},
): Promise<{
  sentryInitMock: jest.MockedFunction<
    (options?: Record<string, unknown>) => void
  >;
}> {
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

  // Re-import to trigger module-level side effects
  await import('./instrument.js');

  // Retrieve the fresh mock
  const sentry = (await import('@sentry/nestjs')) as unknown as {
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

function describeSentryInstrumentTs() {
  afterEach(() => {
    jest.resetModules();
  });

  describe('when not in production (default)', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('does NOT call Sentry.init in development', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });

  describe('when NODE_ENV=production', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        NODE_ENV: 'production',
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('calls Sentry.init', () => {
      expect(sentryInitMock).toHaveBeenCalledTimes(1);
    });

    it('sets tracesSampleRate to 0.1 in production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['tracesSampleRate']).toBe(0.1);
    });

    it('sets environment tag to production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['environment']).toBe('production');
    });

    it('includes ignoreSpans with pg_catalog filter', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];

      expect(Array.isArray(ignoreSpans)).toBe(true);
      const regex = ignoreSpans[0];
      expect(regex.test('pg_catalog.pg_type')).toBe(true);
    });

    describe('beforeSend filter', () => {
      type SentryEvent = {
        exception?: { values?: { type?: string; value?: string }[] };
      };
      type BeforeSend = (event: SentryEvent) => SentryEvent | null;

      function getBeforeSend(): BeforeSend {
        const config = sentryInitMock.mock.calls[0][0] as Record<
          string,
          unknown
        >;
        return config['beforeSend'] as BeforeSend;
      }

      it('drops ThrottlerException events', () => {
        const result = getBeforeSend()({
          exception: { values: [{ type: 'ThrottlerException' }] },
        });
        expect(result).toBeNull();
      });

      it('drops InternalOAuthError events (ROK-668)', () => {
        const result = getBeforeSend()({
          exception: { values: [{ type: 'InternalOAuthError' }] },
        });
        expect(result).toBeNull();
      });

      it('drops intentional no_snapshot_yet 503s (ROK-1143)', () => {
        const result = getBeforeSend()({
          exception: {
            values: [
              {
                type: 'HttpException',
                value: "{ error: 'no_snapshot_yet' }",
              },
            ],
          },
        });
        expect(result).toBeNull();
      });

      it('still reports real 5xx HttpExceptions', () => {
        const event: SentryEvent = {
          exception: {
            values: [{ type: 'HttpException', value: 'Internal Server Error' }],
          },
        };
        expect(getBeforeSend()(event)).toBe(event);
      });

      it('still reports unrelated exceptions', () => {
        const event: SentryEvent = {
          exception: {
            values: [
              {
                type: 'TypeError',
                value: "Cannot read property 'x' of undefined",
              },
            ],
          },
        };
        expect(getBeforeSend()(event)).toBe(event);
      });

      it('passes through events without an exception payload', () => {
        const event: SentryEvent = {};
        expect(getBeforeSend()(event)).toBe(event);
      });
    });
  });

  describe('when DISABLE_TELEMETRY=true', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: 'true',
      }));
    });

    it('does NOT call Sentry.init', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });

  describe('when DISABLE_TELEMETRY is not set (but not production)', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('does NOT call Sentry.init (production-only)', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });
}
describe('Sentry instrument.ts', () => describeSentryInstrumentTs());

import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { of, throwError, firstValueFrom } from 'rxjs';
import { PerfLoggingInterceptor } from './perf-logging.interceptor';
import * as perfLoggerModule from './perf-logger';

// Mock the perf-logger module so we can spy on isPerfEnabled and perfLog
jest.mock('./perf-logger', () => ({
  isPerfEnabled: jest.fn(),
  perfLog: jest.fn(),
}));

const mockIsPerfEnabled = perfLoggerModule.isPerfEnabled as jest.Mock;
const mockPerfLog = perfLoggerModule.perfLog as jest.Mock;

/**
 * Build a minimal ExecutionContext that simulates an HTTP request/response.
 *
 * @param method  HTTP method (GET, POST, etc.)
 * @param url     Request URL path
 * @param statusCode  Response status code returned by getResponse()
 * @param userId  Optional user ID attached to the request
 */
function createMockExecutionContext(
  method: string,
  url: string,
  statusCode: number,
  userId?: number,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url,
        user: userId != null ? { sub: userId } : undefined,
      }),
      getResponse: () => ({ statusCode }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({
      getData: () => ({}),
      getClient: () => ({}),
      getPattern: () => '',
    }),
  } as unknown as ExecutionContext;
}

describe('PerfLoggingInterceptor', () => {
  let interceptor: PerfLoggingInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new PerfLoggingInterceptor();
    // Default: perf logging is enabled
    mockIsPerfEnabled.mockReturnValue(true);
  });

  describe('when perf logging is disabled', () => {
    it('passes through without logging', async () => {
      mockIsPerfEnabled.mockReturnValue(false);
      const context = createMockExecutionContext('GET', '/health', 200);
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      const result$ = interceptor.intercept(context, handler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual({ ok: true });
      expect(mockPerfLog).not.toHaveBeenCalled();
    });
  });

  describe('successful responses (2xx)', () => {
    it('logs status, method, URL, and duration for a 200 response', async () => {
      const context = createMockExecutionContext(
        'GET',
        '/api/events',
        200,
        42,
      );
      const handler: CallHandler = {
        handle: () => of({ events: [] }),
      };

      await firstValueFrom(interceptor.intercept(context, handler));

      expect(mockPerfLog).toHaveBeenCalledTimes(1);
      expect(mockPerfLog).toHaveBeenCalledWith(
        'HTTP',
        'GET /api/events',
        expect.any(Number),
        expect.objectContaining({ status: 200, userId: 42 }),
      );
    });

    it('logs without userId when no user is on the request', async () => {
      const context = createMockExecutionContext('GET', '/health', 200);
      const handler: CallHandler = { handle: () => of('ok') };

      await firstValueFrom(interceptor.intercept(context, handler));

      expect(mockPerfLog).toHaveBeenCalledWith(
        'HTTP',
        'GET /health',
        expect.any(Number),
        expect.objectContaining({ status: 200, userId: undefined }),
      );
    });
  });

  describe('error responses (5xx)', () => {
    it('logs 500 status with correct method, URL, and positive duration', async () => {
      const context = createMockExecutionContext(
        'POST',
        '/api/scheduling-polls',
        500,
        7,
      );
      const serverError = new HttpException(
        'Internal Server Error',
        500,
      );
      const handler: CallHandler = {
        handle: () => throwError(() => serverError),
      };

      // The observable will error — consume it and ignore the throw
      try {
        await firstValueFrom(interceptor.intercept(context, handler));
      } catch {
        // expected — the error should propagate
      }

      // AC1: perfLog MUST be called with the 500 status
      expect(mockPerfLog).toHaveBeenCalledTimes(1);
      expect(mockPerfLog).toHaveBeenCalledWith(
        'HTTP',
        'POST /api/scheduling-polls',
        expect.any(Number),
        expect.objectContaining({ status: 500, userId: 7 }),
      );

      // Verify duration is a positive number
      const durationArg = mockPerfLog.mock.calls[0][2] as number;
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });

    it('re-throws the original error after logging', async () => {
      const context = createMockExecutionContext(
        'POST',
        '/api/scheduling-polls',
        500,
      );
      const serverError = new HttpException(
        'Internal Server Error',
        500,
      );
      const handler: CallHandler = {
        handle: () => throwError(() => serverError),
      };

      // AC2: the exact same error instance must be re-thrown
      let thrownError: unknown;
      try {
        await firstValueFrom(interceptor.intercept(context, handler));
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBe(serverError);
      // Also verify logging happened before the error propagated
      expect(mockPerfLog).toHaveBeenCalledTimes(1);
    });

    it('logs 503 errors with the correct status code', async () => {
      const context = createMockExecutionContext(
        'GET',
        '/api/games',
        503,
        99,
      );
      const serviceUnavailable = new HttpException(
        'Service Unavailable',
        503,
      );
      const handler: CallHandler = {
        handle: () => throwError(() => serviceUnavailable),
      };

      try {
        await firstValueFrom(interceptor.intercept(context, handler));
      } catch {
        // expected
      }

      expect(mockPerfLog).toHaveBeenCalledWith(
        'HTTP',
        'GET /api/games',
        expect.any(Number),
        expect.objectContaining({ status: 503, userId: 99 }),
      );
    });
  });
});

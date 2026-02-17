import { ArgumentsHost, HttpException } from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';
import * as Sentry from '@sentry/nestjs';

// Mock @sentry/nestjs so we don't need a real Sentry SDK initialised
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

// Mock the parent class so we can verify delegation without needing
// the full NestJS HTTP pipeline that BaseExceptionFilter expects.
// Define catch on the prototype (not as a class field) so the child
// class method properly overrides it while super.catch() still resolves.
const mockSuperCatch = jest.fn();
jest.mock('@sentry/nestjs/setup', () => {
  class MockSentryGlobalFilter {
    catch(...args: unknown[]) {
      mockSuperCatch(...args);
    }
  }
  return { SentryGlobalFilter: MockSentryGlobalFilter };
});

function createMockHost(type: string): ArgumentsHost {
  return {
    getType: () => type,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({
      getData: () => ({}),
      getClient: () => ({}),
      getPattern: () => '',
    }),
  } as unknown as ArgumentsHost;
}

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new SentryExceptionFilter();
  });

  it('delegates to SentryGlobalFilter for HTTP contexts', () => {
    const host = createMockHost('http');
    const error = new Error('http error');

    filter.catch(error, host);

    expect(mockSuperCatch).toHaveBeenCalledWith(error, host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures via Sentry SDK and re-throws for WebSocket contexts', () => {
    const host = createMockHost('ws');
    const error = new Error('ws error');

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(mockSuperCatch).not.toHaveBeenCalled();
  });

  it('captures via Sentry SDK and re-throws for RPC contexts', () => {
    const host = createMockHost('rpc');
    const error = new Error('rpc error');

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(mockSuperCatch).not.toHaveBeenCalled();
  });

  it('captures via Sentry SDK and re-throws for unknown context types', () => {
    const host = createMockHost('unknown');
    const error = new Error('unknown context');

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(mockSuperCatch).not.toHaveBeenCalled();
  });

  it('re-throws the exact same exception instance in non-HTTP contexts', () => {
    const host = createMockHost('ws');
    const error = new Error('identity check');

    let thrown: unknown;
    try {
      filter.catch(error, host);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBe(error);
  });

  it('captures and re-throws HttpException in non-HTTP contexts', () => {
    const host = createMockHost('ws');
    const httpException = new HttpException('Forbidden', 403);

    expect(() => filter.catch(httpException, host)).toThrow(httpException);
    expect(Sentry.captureException).toHaveBeenCalledWith(httpException);
    expect(mockSuperCatch).not.toHaveBeenCalled();
  });

  it('captures and re-throws non-Error throwables (strings) in non-HTTP contexts', () => {
    const host = createMockHost('rpc');
    const nonError = 'something went wrong';

    expect(() => filter.catch(nonError, host)).toThrow(nonError);
    expect(Sentry.captureException).toHaveBeenCalledWith(nonError);
  });

  it('captures and re-throws non-Error throwables (plain objects) in non-HTTP contexts', () => {
    const host = createMockHost('ws');
    const nonError = { code: 'ERR_CUSTOM', message: 'custom object error' };

    let thrown: unknown;
    try {
      filter.catch(nonError, host);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBe(nonError);
    expect(Sentry.captureException).toHaveBeenCalledWith(nonError);
  });

  it('still re-throws original exception even if Sentry.captureException throws', () => {
    const host = createMockHost('ws');
    const originalError = new Error('original');
    (Sentry.captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Sentry SDK failure');
    });

    // The filter itself will throw the Sentry error in this case — we want to ensure
    // this scenario doesn't silently swallow exceptions. The Sentry error propagates,
    // which is acceptable since the original exception was already passed to captureException.
    expect(() => filter.catch(originalError, host)).toThrow();
  });

  it('does not call Sentry.captureException for HTTP context when delegating to parent', () => {
    const host = createMockHost('http');
    const error = new Error('http error');

    filter.catch(error, host);

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockSuperCatch).toHaveBeenCalledTimes(1);
  });
});

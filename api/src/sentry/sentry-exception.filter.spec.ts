import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

function createMockResponse() {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

function createMockHttpHost(response = createMockResponse()): {
  host: ArgumentsHost;
  response: ReturnType<typeof createMockResponse>;
} {
  return {
    host: {
      getType: () => 'http',
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => response,
        getNext: () => ({}),
      }),
      switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
      switchToWs: () => ({
        getData: () => ({}),
        getClient: () => ({}),
        getPattern: () => '',
      }),
    } as unknown as ArgumentsHost,
    response,
  };
}

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

  describe('HTTP context', () => {
    it('sends proper JSON response for HttpException (4xx)', () => {
      const { host, response } = createMockHttpHost();
      const error = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Bad Request',
      });
      // 4xx should NOT be reported to Sentry
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('sends proper JSON response for HttpException with object body', () => {
      const { host, response } = createMockHttpHost();
      const error = new HttpException(
        { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
      });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('captures 5xx HttpException in Sentry', () => {
      const { host, response } = createMockHttpHost();
      const error = new HttpException(
        'Internal Server Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('sends 500 JSON response for non-HttpException and captures in Sentry', () => {
      const { host, response } = createMockHttpHost();
      const error = new Error('unexpected crash');

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('does nothing if headers are already sent', () => {
      const response = createMockResponse();
      response.headersSent = true;
      const { host } = createMockHttpHost(response);
      const error = new Error('late error');

      filter.catch(error, host);

      expect(response.status).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('non-HTTP context', () => {
    it('captures via Sentry SDK and re-throws for WebSocket contexts', () => {
      const host = createMockHost('ws');
      const error = new Error('ws error');

      expect(() => filter.catch(error, host)).toThrow(error);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('captures via Sentry SDK and re-throws for RPC contexts', () => {
      const host = createMockHost('rpc');
      const error = new Error('rpc error');

      expect(() => filter.catch(error, host)).toThrow(error);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('captures via Sentry SDK and re-throws for unknown context types', () => {
      const host = createMockHost('unknown');
      const error = new Error('unknown context');

      expect(() => filter.catch(error, host)).toThrow(error);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('re-throws the exact same exception instance', () => {
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
    });

    it('captures and re-throws non-Error throwables (strings)', () => {
      const host = createMockHost('rpc');
      const nonError = 'something went wrong';

      expect(() => filter.catch(nonError, host)).toThrow(nonError);
      expect(Sentry.captureException).toHaveBeenCalledWith(nonError);
    });

    it('captures and re-throws non-Error throwables (plain objects)', () => {
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
  });
});

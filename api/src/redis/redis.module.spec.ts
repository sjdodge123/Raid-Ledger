import { retryStrategy, createRedisClient } from './redis.module';

jest.mock('ioredis', () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const mockInstance: Record<string, unknown> = {
    _emit: (event: string, ...args: unknown[]) => {
      (listeners[event] || []).forEach((fn) => fn(...args));
    },
    _listeners: listeners,
    options: {},
  };

  mockInstance.on = jest.fn(
    (event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return mockInstance;
    },
  );

  const MockRedis = jest.fn(() => mockInstance);
  return { __esModule: true, default: MockRedis };
});

function getMockInstance() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Redis = require('ioredis').default;
  return Redis.mock.results[Redis.mock.results.length - 1].value;
}

describe('retryStrategy', () => {
  it('returns times * 200ms', () => {
    expect(retryStrategy(1)).toBe(200);
    expect(retryStrategy(5)).toBe(1000);
    expect(retryStrategy(10)).toBe(2000);
  });

  it('caps at 5 000ms', () => {
    expect(retryStrategy(25)).toBe(5000);
    expect(retryStrategy(100)).toBe(5000);
  });
});

describe('createRedisClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers error, connect, and close listeners', () => {
    const client = createRedisClient('redis://localhost:6379');
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('error handler logs but does not throw', () => {
    createRedisClient('redis://localhost:6379');
    const instance = getMockInstance() as {
      _emit: (event: string, ...args: unknown[]) => void;
    };

    expect(() => {
      instance._emit('error', new Error('ECONNREFUSED'));
    }).not.toThrow();
  });

  it('passes retryStrategy and maxRetriesPerRequest to constructor', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis').default;
    createRedisClient('redis://localhost:6379');

    const call = Redis.mock.calls[Redis.mock.calls.length - 1];
    // TCP path: new Redis(url, opts)
    const opts = call[1];
    expect(opts.retryStrategy).toBe(retryStrategy);
    expect(opts.maxRetriesPerRequest).toBe(3);
    expect(opts.lazyConnect).toBe(true);
  });

  it('uses path option for Unix socket URLs', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis').default;
    createRedisClient('/tmp/redis.sock');

    const call = Redis.mock.calls[Redis.mock.calls.length - 1];
    // Unix socket path: new Redis(opts) with path
    const opts = call[0];
    expect(opts.path).toBe('/tmp/redis.sock');
    expect(opts.lazyConnect).toBe(true);
  });
});

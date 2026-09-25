import { Redis, type RedisOptions } from 'ioredis';
import { buildBullRootOptions } from './queue.module';

/**
 * Resolve the ioredis options BullMQ ends up using, the same way
 * `RedisConnection.init()` does: `new IORedis(url, rest)`. `lazyConnect`
 * keeps it from opening a socket.
 */
function resolveIoredisOptions(url: string): RedisOptions {
  const { connection } = buildBullRootOptions(url);
  const { url: connUrl, ...rest } = connection as {
    url?: string;
  } & RedisOptions;
  // BullMQ's RedisConnection seeds these defaults before init() hands
  // `(url, rest)` to ioredis — the URL must still win over them.
  const withDefaults = { port: 6379, host: '127.0.0.1', ...rest };
  const client = connUrl
    ? new Redis(connUrl, { ...withDefaults, lazyConnect: true })
    : new Redis({ ...withDefaults, lazyConnect: true });
  const { options } = client;
  client.disconnect();
  return options;
}

describe('buildBullRootOptions (ROK-1664)', () => {
  it('keeps TLS, ACL username, db index and the decoded password from a rediss:// URL', () => {
    const opts = resolveIoredisOptions(
      'rediss://user:p%40ss@cache.example.com:6380/2',
    );

    expect(opts.tls).toBeTruthy();
    expect(opts.username).toBe('user');
    expect(opts.password).toBe('p@ss');
    expect(opts.db).toBe(2);
    expect(opts.host).toBe('cache.example.com');
    expect(opts.port).toBe(6380);
  });

  it('connects in plaintext to the compose redis:// URL', () => {
    const opts = resolveIoredisOptions('redis://redis:6379');

    expect(opts.tls).toBeUndefined();
    expect(opts.host).toBe('redis');
    expect(opts.port).toBe(6379);
  });

  it('keeps the unix-socket shape the allinone image relies on', () => {
    expect(buildBullRootOptions('/tmp/redis.sock')).toEqual({
      connection: { path: '/tmp/redis.sock' },
    });
  });

  it('carries the key prefix as the bullmq prefix option on the socket path', () => {
    expect(buildBullRootOptions('/tmp/redis.sock', 'test-1-')).toEqual({
      connection: { path: '/tmp/redis.sock' },
      prefix: 'test-1-',
    });
  });
});

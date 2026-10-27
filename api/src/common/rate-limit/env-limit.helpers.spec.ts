import { HttpException, HttpStatus } from '@nestjs/common';
import { envLimit, positiveIntFromEnv, rateLimited } from './env-limit.helpers';

const KEYS = ['RL_TEST_LIMIT', 'THROTTLE_DISABLED', 'DEMO_MODE'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('envLimit (ROK-1955, extracted from ROK-1833)', () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it('returns the fallback when the env var is unset or not a positive int', () => {
    expect(envLimit('RL_TEST_LIMIT', 30)).toBe(30);
    for (const bad of ['0', '-4', 'abc', '']) {
      process.env.RL_TEST_LIMIT = bad;
      expect(envLimit('RL_TEST_LIMIT', 30)).toBe(30);
    }
  });

  it('honours a positive env override, even with THROTTLE_DISABLED', () => {
    process.env.RL_TEST_LIMIT = '7';
    expect(envLimit('RL_TEST_LIMIT', 30)).toBe(7);
    process.env.THROTTLE_DISABLED = 'true';
    expect(envLimit('RL_TEST_LIMIT', 30)).toBe(7);
  });

  it('THROTTLE_DISABLED lifts only the default; DEMO_MODE never does', () => {
    process.env.DEMO_MODE = 'true';
    expect(envLimit('RL_TEST_LIMIT', 30)).toBe(30);
    process.env.THROTTLE_DISABLED = 'true';
    expect(envLimit('RL_TEST_LIMIT', 30)).toBeNull();
  });
});

describe('positiveIntFromEnv (ROK-1955)', () => {
  it('reads a positive integer, else the fallback', () => {
    delete process.env.RL_TEST_LIMIT;
    expect(positiveIntFromEnv('RL_TEST_LIMIT', 10_000)).toBe(10_000);
    process.env.RL_TEST_LIMIT = '0';
    expect(positiveIntFromEnv('RL_TEST_LIMIT', 10_000)).toBe(10_000);
    process.env.RL_TEST_LIMIT = '250';
    expect(positiveIntFromEnv('RL_TEST_LIMIT', 10_000)).toBe(250);
  });
});

describe('rateLimited (ROK-1955)', () => {
  it('is a 429 with the { code: rate_limited, message } body', () => {
    const err = rateLimited('slow down');
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(err.getResponse()).toEqual({
      code: 'rate_limited',
      message: 'slow down',
    });
  });
});

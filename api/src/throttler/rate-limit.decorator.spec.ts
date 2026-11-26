import { SigninCodeController } from '../auth/signin-code.controller';
import { RATE_LIMIT_TIERS, RateLimit } from './rate-limit.decorator';

describe('RATE_LIMIT_TIERS', () => {
  it('should define auth tier as 10/min', () => {
    expect(RATE_LIMIT_TIERS.auth).toEqual({ ttl: 60_000, limit: 10 });
  });

  it('should define search tier as 30/min', () => {
    expect(RATE_LIMIT_TIERS.search).toEqual({ ttl: 60_000, limit: 30 });
  });

  it('should define admin tier as 120/min', () => {
    expect(RATE_LIMIT_TIERS.admin).toEqual({ ttl: 60_000, limit: 120 });
  });

  it('should define public tier as 60/min (ROK-1067)', () => {
    expect(RATE_LIMIT_TIERS.public).toEqual({ ttl: 60_000, limit: 60 });
  });

  it('should define the sign-in code tiers (ROK-2370 AC3)', () => {
    expect(RATE_LIMIT_TIERS.signinStart).toEqual({ ttl: 600_000, limit: 5 });
    expect(RATE_LIMIT_TIERS.signinPoll).toEqual({ ttl: 60_000, limit: 40 });
  });

  it('should define media tier as 600/min (ROK-1942)', () => {
    expect(RATE_LIMIT_TIERS.media).toEqual({ ttl: 60_000, limit: 600 });
  });

  it('should define pollCreate tier as 10/min (TDB L2886)', () => {
    expect(RATE_LIMIT_TIERS.pollCreate).toEqual({ ttl: 60_000, limit: 10 });
  });
});

/** Re-evaluate the module under a given env — the tiers are read at import. */
function loadTiers(env: Record<string, string | undefined>) {
  const saved = Object.keys(env).map((key) => [key, process.env[key]] as const);
  const apply = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  Object.entries(env).forEach(([key, value]) => apply(key, value));
  let tiers!: typeof RATE_LIMIT_TIERS;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./rate-limit.decorator') as {
      RATE_LIMIT_TIERS: typeof RATE_LIMIT_TIERS;
    };
    tiers = mod.RATE_LIMIT_TIERS;
  });
  saved.forEach(([key, value]) => apply(key, value));
  return tiers;
}

describe('RATE_LIMIT_TIERS under DEMO_MODE (ROK-1633)', () => {
  const demo = { DEMO_MODE: 'true', THROTTLE_DISABLED: undefined };

  it.each(['search', 'refresh', 'media', 'pollCreate'] as const)(
    'lifts the %s tier',
    (tier) => {
      expect(loadTiers(demo)[tier].limit).toBe(999_999);
    },
  );

  it.each([
    ['auth', 10],
    ['admin', 120],
    ['export', 5],
    ['public', 60],
    ['signinStart', 5],
    ['signinPoll', 40],
  ] as const)('keeps the %s tier at %i/min', (tier, limit) => {
    expect(loadTiers(demo)[tier].limit).toBe(limit);
  });

  it('changes nothing when DEMO_MODE is unset', () => {
    const tiers = loadTiers({
      DEMO_MODE: undefined,
      THROTTLE_DISABLED: undefined,
    });
    expect(tiers.search.limit).toBe(30);
    expect(tiers.refresh.limit).toBe(60);
  });
});

function describeRateLimitDecorator() {
  it('should return a decorator function for each tier', () => {
    expect(typeof RateLimit('auth')).toBe('function');
    expect(typeof RateLimit('search')).toBe('function');
    expect(typeof RateLimit('admin')).toBe('function');
  });

  it('should apply throttle limit metadata to a class', () => {
    @RateLimit('auth')
    class TestClass {}

    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', TestClass);
    expect(limit).toBe(10);
  });

  it('should apply throttle ttl metadata to a class', () => {
    @RateLimit('auth')
    class TestClass {}

    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', TestClass);
    expect(ttl).toBe(60_000);
  });

  it('should apply throttle metadata to a method descriptor', () => {
    class TestClass {
      @RateLimit('search')
      testMethod() {}
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      TestClass.prototype,
      'testMethod',
    )!;

    const target = descriptor.value as object;
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', target);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', target);
    expect(limit).toBe(30);
    expect(ttl).toBe(60_000);
  });
}
describe('RateLimit decorator', () => describeRateLimitDecorator());

describe('SigninCodeController throttles (ROK-2370 AC3)', () => {
  it.each([
    ['start', 5, 600_000],
    ['poll', 40, 60_000],
  ] as const)('%s carries its tier', (method, limit, ttl) => {
    const target = SigninCodeController.prototype[method] as object;
    expect([
      Reflect.getMetadata('THROTTLER:LIMITdefault', target),
      Reflect.getMetadata('THROTTLER:TTLdefault', target),
    ]).toEqual([limit, ttl]);
  });
});

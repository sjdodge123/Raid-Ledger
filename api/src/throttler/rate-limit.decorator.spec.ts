/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
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
});

describe('RateLimit decorator', () => {
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

    const limit = Reflect.getMetadata(
      'THROTTLER:LIMITdefault',
      descriptor.value,
    );
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', descriptor.value);
    expect(limit).toBe(30);
    expect(ttl).toBe(60_000);
  });
});

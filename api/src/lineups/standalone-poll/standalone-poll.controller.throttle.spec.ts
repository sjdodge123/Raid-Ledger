/**
 * TDB L2886: POST /scheduling-polls fans out DMs and a channel card per poll,
 * so it carries a route-level throttle tighter than the global 60/min.
 */
import { StandalonePollController } from './standalone-poll.controller';
import { RATE_LIMIT_TIERS } from '../../throttler/rate-limit.decorator';

/** Read a `@Throttle` metadata value off a controller method. */
function throttleMeta(method: string, key: 'LIMIT' | 'TTL'): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    StandalonePollController.prototype,
    method,
  );
  const target: unknown = descriptor?.value;
  if (typeof target !== 'function') throw new Error(`no method ${method}`);
  return Reflect.getMetadata(`THROTTLER:${key}default`, target);
}

describe('StandalonePollController — create throttle', () => {
  it('throttles POST /scheduling-polls with the pollCreate tier', () => {
    expect(throttleMeta('create', 'LIMIT')).toBe(
      RATE_LIMIT_TIERS.pollCreate.limit,
    );
    expect(throttleMeta('create', 'TTL')).toBe(60_000);
  });

  it('is tighter than the global 60/min outside test/demo envs', () => {
    expect(RATE_LIMIT_TIERS.pollCreate.limit).toBeLessThan(60);
  });
});

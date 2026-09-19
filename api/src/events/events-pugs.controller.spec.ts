/**
 * ROK-1626 — every route on `EventsPugsController` carries the same guards.
 *
 * The assertion walks EVERY route handler rather than naming one: a missing
 * guard is an omission, and the next omission will be on a handler this file
 * has never heard of.
 */
import { AuthGuard } from '@nestjs/passport';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { EventsPugsController } from './events-pugs.controller';

type Handler = (...args: unknown[]) => unknown;

/** Every method on the controller that Nest registered as a route. */
function routeHandlers(): [string, Handler][] {
  const proto = EventsPugsController.prototype as unknown as Record<
    string,
    Handler
  >;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name): [string, Handler] => [name, proto[name]])
    .filter(([, fn]) => Reflect.hasMetadata(PATH_METADATA, fn));
}

describe('EventsPugsController guards (ROK-1626)', () => {
  it('finds the routes it is meant to be checking', () => {
    const names = routeHandlers().map(([name]) => name);

    expect(names).toContain('listPugs');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it.each(routeHandlers())(
    '%s requires a JWT and a non-deactivated user',
    (_name, handler) => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];

      // `AuthGuard` memoizes per strategy, so identity comparison holds.
      expect(guards).toContain(AuthGuard('jwt'));
      expect(guards).toContain(NotDeactivatedGuard);
    },
  );
});

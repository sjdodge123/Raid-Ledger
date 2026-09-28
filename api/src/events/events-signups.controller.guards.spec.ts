/**
 * ROK-1629 (AC1) — GET /events/:id/roster/availability is members-only.
 *
 * The route used to carry no guard, so anyone on the internet could read
 * every signed-up member's availability windows for any event id.
 */
import { AuthGuard } from '@nestjs/passport';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { EventsSignupsController } from './events-signups.controller';

function guardsOf(method: keyof EventsSignupsController): unknown[] {
  const handler = EventsSignupsController.prototype[method];
  return (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
}

describe('EventsSignupsController guards (ROK-1629)', () => {
  it('getRosterAvailability requires a JWT and a non-deactivated user', () => {
    const guards = guardsOf('getRosterAvailability');

    // `AuthGuard` memoizes per strategy, so identity comparison holds.
    expect(guards).toContain(AuthGuard('jwt'));
    expect(guards).toContain(NotDeactivatedGuard);
  });
});

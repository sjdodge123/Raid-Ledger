/**
 * ROK-2039 — integration fixture: an event created FROM a scheduling poll the
 * way the pre-ROK-2032 form did it (provenance-checked, creator signed up),
 * without the HTTP `POST /events` door, which now 400s on `schedulingMatchId`.
 *
 * For specs whose subject is `POST /scheduling-polls/:matchId/complete` (still
 * live for reschedules and events created before the lock-in endpoint). Specs
 * about locking in use `POST /scheduling-polls/:matchId/lock-in` instead.
 */
import { CreateEventSchema } from '@raid-ledger/contract';
import type { TestApp } from './test-app';
import { EventsService } from '../../events/events.service';
import { SignupsService } from '../../events/signups.service';
import { LfgEventConvertService } from '../../lfg/lfg-event-convert.service';
import { createEventWithSignups } from '../../events/event-create-lfg.helpers';
import { assertSchedulingMatchUsable } from '../../events/event-poll-provenance.helpers';

/**
 * Create an event as staff user `userId` from a raw create body (which may
 * carry `schedulingMatchId`); returns the new event id.
 */
export async function createPollEventDirect(
  testApp: TestApp,
  userId: number,
  body: Record<string, unknown>,
): Promise<number> {
  const dto = CreateEventSchema.parse(body);
  await assertSchedulingMatchUsable(testApp.db, dto, {
    id: userId,
    isStaff: true,
  });
  const deps = {
    eventsService: testApp.app.get(EventsService),
    signupsService: testApp.app.get(SignupsService),
    lfgEventConvert: testApp.app.get(LfgEventConvertService),
  };
  const event = await createEventWithSignups(deps, userId, dto);
  return event.id;
}

/**
 * The `POST /events` create flow, extracted from `EventsController` for the
 * file-length limit when ROK-1573 added LFG convert-on-create.
 */
import type { CreateEventDto, EventResponseDto } from '@raid-ledger/contract';
import type { LfgEventConvertService } from '../lfg/lfg-event-convert.service';
import { autoSignupSlotVoters } from '../lineups/scheduling/scheduling-auto-signup.helpers';
import type { EventsService } from './events.service';
import type { SignupsService } from './signups.service';

/** Services the create flow needs. */
export interface EventCreateDeps {
  eventsService: Pick<EventsService, 'create'>;
  signupsService: Pick<SignupsService, 'signup'>;
  lfgEventConvert: Pick<LfgEventConvertService, 'createForGroup'>;
}

/** The creator joins every occurrence (unchanged pre-ROK-1573 behaviour). */
async function signupCreator(
  deps: EventCreateDeps,
  userId: number,
  eventIds: number[],
): Promise<void> {
  await Promise.all(
    eventIds.map((id) =>
      deps.signupsService.signup(id, userId, undefined, {
        skipEndedCheck: true,
      }),
    ),
  );
}

/**
 * Create an event, convert its LFG group (when `lfgGameId` is set) and sign
 * everyone up.
 *
 * With `lfgGameId` the create itself runs inside the group lock (see
 * `createAndConvertGroup`): a caller who no longer holds a live intent gets a
 * 409 and NO event. Order matters: the conversion commits BEFORE the creator's
 * signup, whose listener would otherwise clear the creator's `active` intent.
 * Converted members join occurrence 1 only (Q8); the creator joins every
 * occurrence, as before.
 *
 * @param deps - Events, signups and LFG conversion services.
 * @param userId - The creator.
 * @param dto - Parsed create body.
 * @returns The created event (without the internal `allEventIds`).
 * @throws ConflictException when `lfgGameId` names a group the caller is not
 *   live in.
 */
export async function createEventWithSignups(
  deps: EventCreateDeps,
  userId: number,
  dto: CreateEventDto,
): Promise<EventResponseDto> {
  const create = () => deps.eventsService.create(userId, dto);
  const { event: result, memberIds } = dto.lfgGameId
    ? await deps.lfgEventConvert.createForGroup(userId, dto.lfgGameId, create)
    : { event: await create(), memberIds: [] as number[] };
  await signupCreator(deps, userId, result.allEventIds ?? [result.id]);
  if (memberIds.length > 0) {
    await autoSignupSlotVoters({
      eventId: result.id,
      creatorId: userId,
      voters: memberIds.map((memberId) => ({ userId: memberId })),
      signupsService: deps.signupsService,
    });
  }
  const { allEventIds: _, ...event } = result;
  void _;
  return event;
}

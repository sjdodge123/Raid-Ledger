/**
 * The `POST /events` create flow, extracted from `EventsController` for the
 * file-length limit when ROK-1573 added LFG convert-on-create.
 */
import type {
  CreateEventDto,
  CreateSignupDto,
  EventResponseDto,
} from '@raid-ledger/contract';
import type { LfgEventPatch } from '../lfg/lfg-event-convert.helpers';
import type { LfgEventConvertService } from '../lfg/lfg-event-convert.service';
import {
  autoSignupSlotVoters,
  type SignupCarryover,
} from '../lineups/scheduling/scheduling-auto-signup.helpers';
import { withDefaultRosterSlots } from './event-roster-slots.helpers';
import type { EventsService } from './events.service';
import type { SignupsService } from './signups.service';

/** Services the create flow needs. */
export interface EventCreateDeps {
  eventsService: Pick<EventsService, 'create'>;
  signupsService: Pick<SignupsService, 'signup'>;
  lfgEventConvert: Pick<LfgEventConvertService, 'createForGroup'>;
}

/**
 * Give an LFG Lock-in a roster to sign into unless the body set one.
 *
 * ROK-1606 extracted the slot config itself to `event-roster-slots.helpers`
 * so the scheduling-poll lock-in gets the same default; the `lfgGameId` gate
 * (only LFG converts are re-shaped here) is unchanged.
 */
export function withLfgRosterSlots(dto: CreateEventDto): CreateEventDto {
  if (!dto.lfgGameId) return dto;
  return withDefaultRosterSlots(dto);
}

/**
 * ROK-2352 §3.8 — the grouping adapter's roster, instance and title win over
 * the body's: the Lock-in IS that instance (AC5). No patch (folded or
 * non-grouped game) → the body as sent, with the generic roster.
 *
 * @param dto - Parsed create body.
 * @param patch - From the adapter, inside the group lock.
 */
export function withLfgLockInPatch(
  dto: CreateEventDto,
  patch: LfgEventPatch | undefined,
): CreateEventDto {
  const patched: CreateEventDto = {
    ...dto,
    ...(patch?.title ? { title: patch.title } : {}),
    ...(patch?.slotConfig ? { slotConfig: patch.slotConfig } : {}),
    ...(patch?.contentInstances
      ? { contentInstances: patch.contentInstances }
      : {}),
  };
  return withLfgRosterSlots(patched);
}

/**
 * The creator joins every occurrence (unchanged pre-ROK-1573 behaviour) —
 * ROK-2352: with their hand's character/roles when the adapter carried any.
 * A carried signup that throws (stale character) retries plain, so a
 * carryover can never fail the create.
 */
async function signupCreator(
  deps: EventCreateDeps,
  userId: number,
  eventIds: number[],
  carried: CreateSignupDto | undefined,
): Promise<void> {
  const opts = { skipEndedCheck: true };
  await Promise.all(
    eventIds.map((id) =>
      carried
        ? deps.signupsService
            .signup(id, userId, carried, opts)
            .catch(() => deps.signupsService.signup(id, userId, undefined, opts))
        : deps.signupsService.signup(id, userId, undefined, opts),
    ),
  );
}

/** Converted members (minus the creator) join occurrence 1 with carryover. */
async function signupMembers(
  deps: EventCreateDeps,
  userId: number,
  eventId: number,
  memberIds: number[],
  carryover: SignupCarryover | undefined,
): Promise<void> {
  if (memberIds.length === 0) return;
  await autoSignupSlotVoters({
    eventId,
    creatorId: userId,
    voters: memberIds.map((memberId) => ({ userId: memberId })),
    signupsService: deps.signupsService,
    carryover,
  });
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
 * occurrence, as before. Everyone signs up through `SignupsService.signup`, so
 * roster placement is the normal one — the event just needs player slots
 * (`withLfgRosterSlots`). ROK-2352: with `lfgGroupKey` only that group
 * converts; a grouped game's adapter shapes the event (`withLfgLockInPatch`)
 * and everyone signs up with their hand's character/roles (ROK-2320's
 * `carryover` seam — no new signup path).
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
  const create = (patch?: LfgEventPatch) =>
    deps.eventsService.create(userId, withLfgLockInPatch(dto, patch));
  const converted = dto.lfgGameId
    ? await deps.lfgEventConvert.createForGroup(
        userId,
        dto.lfgGameId,
        create,
        dto.lfgGroupKey,
      )
    : { event: await create(), memberIds: [] as number[] };
  const { event: result, memberIds } = converted;
  const carryover = 'carryover' in converted ? converted.carryover : undefined;
  const ids = result.allEventIds ?? [result.id];
  await signupCreator(deps, userId, ids, carryover?.get(userId));
  await signupMembers(deps, userId, result.id, memberIds, carryover);
  const { allEventIds: _, ...event } = result;
  void _;
  return event;
}

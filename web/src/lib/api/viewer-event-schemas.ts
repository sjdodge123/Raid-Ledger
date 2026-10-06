/**
 * Viewer-dependent event/roster response shapes (ROK-1629).
 *
 * The public event routes (`/events`, `/events/:id`, `/events/:id/roster`,
 * `/events/:id/roster/assignments`, `/events/:id/detail`) answer signed-in
 * members with the full payload and anonymous / deactivated viewers with the
 * public projection — no Discord ids, a server-built avatar URL. The web
 * parses either, so a logged-out page does not fail schema validation, and the
 * union types make every `discordId` read handle its absence.
 *
 * The public schemas re-type a few DB-backed values loosely (see
 * `roster-public.schema.ts`); the declared types stay the DTO unions the
 * contract exports, hence the `ZodType` casts.
 */
import type { ZodType } from 'zod';
import {
    EventListResponseSchema,
    EventResponseSchema,
    EventRosterSchema,
    EventDetailResponseSchema,
    PublicEventResponseSchema,
    PublicEventRosterSchema,
    PublicEventDetailResponseSchema,
} from '@raid-ledger/contract';
import type {
    EventListResponseDto,
    EventResponseDto,
    EventDetailResponseDto,
    RosterAssignmentResponse,
    RosterWithAssignments,
    SignupResponseDto,
    SignupUserDto,
} from '@raid-ledger/contract';

/** A field present for members, absent for anonymous viewers. */
type MemberOnly<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Roster member identity: `discordId` absent for anonymous viewers; `avatar` may be a server-built URL. */
export type ViewerSignupUser = MemberOnly<SignupUserDto, 'discordId'>;
/** Signup row as either viewer sees it (public rows also drop `note`, attendance and running-late). */
export type ViewerSignup = MemberOnly<Omit<SignupResponseDto, 'user'>, 'note'> & { user: ViewerSignupUser };
export type ViewerEventRosterDto = { eventId: number; signups: ViewerSignup[]; count: number };
export type ViewerRosterAssignment = MemberOnly<RosterAssignmentResponse, 'discordId'>;
export type ViewerRosterWithAssignments = Omit<RosterWithAssignments, 'pool' | 'assignments'> & {
    pool: ViewerRosterAssignment[];
    assignments: ViewerRosterAssignment[];
};
export type ViewerEventDetailDto = Omit<EventDetailResponseDto, 'roster' | 'rosterAssignments'> & {
    roster: ViewerEventRosterDto;
    rosterAssignments: ViewerRosterWithAssignments;
};

/*
 * Events (list / findOne) keep the member `EventResponseDto` type: `creator.discordId` is
 * already optional there, and no web consumer reads `signupsPreview[].discordId` (anonymous
 * viewers get it stripped). Retyping it would ripple through every calendar/event prop.
 */
type ViewerEventDto = EventResponseDto;

const ViewerEventSchema = EventResponseSchema.or(PublicEventResponseSchema);

export const ViewerEventResponseSchema = ViewerEventSchema as unknown as ZodType<ViewerEventDto>;

export const ViewerEventListResponseSchema = EventListResponseSchema.extend({
    data: ViewerEventSchema.array(),
}) as unknown as ZodType<EventListResponseDto>;

export const ViewerEventRosterSchema = EventRosterSchema.or(
    PublicEventRosterSchema,
) as unknown as ZodType<ViewerEventRosterDto>;

export const ViewerEventDetailResponseSchema = EventDetailResponseSchema.or(
    PublicEventDetailResponseSchema,
) as unknown as ZodType<ViewerEventDetailDto>;

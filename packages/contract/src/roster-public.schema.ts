import { z } from 'zod';
import {
    SignupUserSchema,
    SignupResponseSchema,
    SignupCharacterSchema,
    type SignupResponseDto,
} from './signups.schema.js';
import {
    RosterAssignmentResponseSchema,
    RosterWithAssignmentsSchema,
    type RosterAssignmentResponse,
    type RosterWithAssignments,
} from './roster.schema.js';
import {
    EventCreatorSchema,
    EventResponseSchema,
    EventDetailResponseSchema,
    type EventDetailResponseDto,
} from './events.schema.js';

// ============================================================
// Public (anonymous-viewer) roster projections (ROK-1629)
//
// Anonymous / deactivated viewers of the public roster surfaces get display
// name, role/class and a SERVER-BUILT avatar URL only — no Discord ids, no
// note, no attendance outcome, no running-late marker. Every shape is DERIVED
// from the member shape (`.omit` / `.extend`) so the two cannot drift, and the
// identity-bearing objects are `.strict()` so a new key fails the API-side
// parse instead of leaking silently.
//
// KEY strictness is the security property; VALUE checks are not. Fields read
// from unconstrained DB columns (varchar enums, uuid, timestamps) are re-typed
// loosely below so legitimate-but-unexpected data (a non-RFC uuid, an unknown
// varchar status) cannot turn a public route into a 500. The exported TS types
// stay derived from the member DTOs, so consumers see the same shapes.
// ============================================================

const looseRoles = z.array(z.string()).nullable().optional();

/** Signup character, value-loose (uuid / role / faction are DB varchar/uuid). */
const PublicSignupCharacterSchema = SignupCharacterSchema.extend({
    id: z.string(),
    role: z.string().nullable(),
    faction: z.string().nullable().optional(),
    professions: z.unknown().optional(),
});

/** Roster member identity for anonymous viewers. `avatar` is an absolute URL or null (server-built). */
export const PublicSignupUserSchema = SignupUserSchema.omit({
    discordId: true,
}).strict();
export type PublicSignupUserDto = z.infer<typeof PublicSignupUserSchema>;

/** Signup row for anonymous viewers (operator ruling Q2: keep slot/status/roles/character). */
export const PublicSignupResponseSchema = SignupResponseSchema.omit({
    discordUserId: true,
    discordAvatarHash: true,
    note: true,
    attendanceStatus: true,
    attendanceRecordedAt: true,
    runningLate: true,
    runningLateAt: true,
    lateMinutes: true,
})
    .extend({
        user: PublicSignupUserSchema,
        signedUpAt: z.string(),
        characterId: z.string().nullable(),
        character: PublicSignupCharacterSchema.nullable(),
        confirmationStatus: z.string(),
        status: z.string(),
        preferredRoles: looseRoles,
        assignedSlot: z.string().nullable().optional(),
    })
    .strict();
export type PublicSignupResponseDto = Omit<
    SignupResponseDto,
    | 'user'
    | 'discordUserId'
    | 'discordAvatarHash'
    | 'note'
    | 'attendanceStatus'
    | 'attendanceRecordedAt'
    | 'runningLate'
    | 'runningLateAt'
    | 'lateMinutes'
> & { user: PublicSignupUserDto };

export const PublicEventRosterSchema = z
    .object({
        eventId: z.number(),
        signups: z.array(PublicSignupResponseSchema),
        count: z.number(),
    })
    .strict();
export type PublicEventRosterDto = {
    eventId: number;
    signups: PublicSignupResponseDto[];
    count: number;
};

/** Roster slot assignment for anonymous viewers. `avatar` is an absolute URL or null. */
export const PublicRosterAssignmentResponseSchema =
    RosterAssignmentResponseSchema.omit({
        discordId: true,
        runningLate: true,
        lateMinutes: true,
    })
        .extend({
            character: RosterAssignmentResponseSchema.shape.character
                .unwrap()
                .extend({ id: z.string() })
                .nullable(),
            slot: z.string().nullable(),
            preferredRoles: looseRoles,
            signupStatus: z.string().optional(),
        })
        .strict();
export type PublicRosterAssignmentResponse = Omit<
    RosterAssignmentResponse,
    'discordId' | 'runningLate' | 'lateMinutes'
>;

export const PublicRosterWithAssignmentsSchema =
    RosterWithAssignmentsSchema.extend({
        pool: z.array(PublicRosterAssignmentResponseSchema),
        assignments: z.array(PublicRosterAssignmentResponseSchema),
    }).strict();
export type PublicRosterWithAssignments = Omit<
    RosterWithAssignments,
    'pool' | 'assignments'
> & {
    pool: PublicRosterAssignmentResponse[];
    assignments: PublicRosterAssignmentResponse[];
};

/** Event creator for anonymous viewers. `avatar` is an absolute URL or null. */
export const PublicEventCreatorSchema = EventCreatorSchema.omit({
    discordId: true,
}).strict();
export type PublicEventCreatorDto = z.infer<typeof PublicEventCreatorSchema>;

/** Event (list item / findOne) for anonymous viewers: creator + signups preview projected. */
export const PublicEventResponseSchema = EventResponseSchema.extend({
    creator: PublicEventCreatorSchema,
    signupsPreview: z.array(PublicSignupUserSchema).optional(),
});
export type PublicEventResponseDto = z.infer<typeof PublicEventResponseSchema>;

/** `GET /events/:id/detail` bundle for anonymous viewers. */
export const PublicEventDetailResponseSchema = EventDetailResponseSchema.extend({
    event: PublicEventResponseSchema,
    roster: PublicEventRosterSchema,
    rosterAssignments: PublicRosterWithAssignmentsSchema,
});
export type PublicEventDetailResponseDto = Omit<
    EventDetailResponseDto,
    'event' | 'roster' | 'rosterAssignments'
> & {
    event: PublicEventResponseDto;
    roster: PublicEventRosterDto;
    rosterAssignments: PublicRosterWithAssignments;
};

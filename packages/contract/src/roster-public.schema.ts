import { z } from 'zod';
import { SignupUserSchema, SignupResponseSchema } from './signups.schema.js';
import {
    RosterAssignmentResponseSchema,
    RosterWithAssignmentsSchema,
} from './roster.schema.js';
import {
    EventCreatorSchema,
    EventResponseSchema,
    EventDetailResponseSchema,
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
// ============================================================

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
    .extend({ user: PublicSignupUserSchema })
    .strict();
export type PublicSignupResponseDto = z.infer<typeof PublicSignupResponseSchema>;

export const PublicEventRosterSchema = z
    .object({
        eventId: z.number(),
        signups: z.array(PublicSignupResponseSchema),
        count: z.number(),
    })
    .strict();
export type PublicEventRosterDto = z.infer<typeof PublicEventRosterSchema>;

/** Roster slot assignment for anonymous viewers. `avatar` is an absolute URL or null. */
export const PublicRosterAssignmentResponseSchema =
    RosterAssignmentResponseSchema.omit({
        discordId: true,
        runningLate: true,
        lateMinutes: true,
    }).strict();
export type PublicRosterAssignmentResponse = z.infer<
    typeof PublicRosterAssignmentResponseSchema
>;

export const PublicRosterWithAssignmentsSchema =
    RosterWithAssignmentsSchema.extend({
        pool: z.array(PublicRosterAssignmentResponseSchema),
        assignments: z.array(PublicRosterAssignmentResponseSchema),
    }).strict();
export type PublicRosterWithAssignments = z.infer<
    typeof PublicRosterWithAssignmentsSchema
>;

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
export type PublicEventDetailResponseDto = z.infer<
    typeof PublicEventDetailResponseSchema
>;

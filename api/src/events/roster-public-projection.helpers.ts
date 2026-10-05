/**
 * Per-viewer projection of the public roster surfaces (ROK-1629).
 *
 * Signed-in, non-deactivated members keep today's payload. Anonymous (and
 * deactivated) viewers get display name, role/class and a server-built avatar
 * URL — no Discord ids, no note / attendance outcome / running-late marker
 * (operator rulings 2026-10-04, Q1/Q2/Q3/Q6).
 *
 * Applied at the HTTP boundary ONLY. `getRoster` / `getRosterWithAssignments`
 * keep the full shape for internal callers (Discord embeds, PATCH responses).
 *
 * Each `toPublic*` builds its output from an explicit whitelist and ends with
 * the strict `Public*Schema.parse`, so a new key cannot leak silently.
 */
import {
  PublicSignupUserSchema,
  PublicSignupResponseSchema,
  PublicEventRosterSchema,
  PublicRosterAssignmentResponseSchema,
  PublicRosterWithAssignmentsSchema,
  PublicEventCreatorSchema,
} from '@raid-ledger/contract';
import type {
  SignupUserDto,
  SignupResponseDto,
  EventRosterDto,
  RosterAssignmentResponse,
  RosterWithAssignments,
  EventCreatorDto,
  EventResponseDto,
  EventDetailResponseDto,
  PublicSignupUserDto,
  PublicSignupResponseDto,
  PublicEventRosterDto,
  PublicRosterAssignmentResponse,
  PublicRosterWithAssignments,
  PublicEventCreatorDto,
  PublicEventResponseDto,
  PublicEventDetailResponseDto,
} from '@raid-ledger/contract';
import { discordAvatarUrl } from '../common/discord-avatar-url.helpers';

/** Viewer rule (Q6): signed in AND not deactivated. Anything else is anonymous. */
export function isMemberViewer(
  user: { deactivatedAt?: Date | string | null } | null | undefined,
): boolean {
  return !!user && !user.deactivatedAt;
}

export function toPublicSignupUser(user: SignupUserDto): PublicSignupUserDto {
  return PublicSignupUserSchema.parse({
    id: user.id,
    username: user.username,
    avatar: discordAvatarUrl(user.discordId, user.avatar),
    customAvatarUrl: user.customAvatarUrl,
    characters: user.characters,
  });
}

/** Anonymous Discord signups carry their avatar hash on the row, not on `user`. */
export function toPublicSignup(
  signup: SignupResponseDto,
): PublicSignupResponseDto {
  const user = toPublicSignupUser({
    ...signup.user,
    discordId: signup.user.discordId || (signup.discordUserId ?? ''),
    avatar: signup.user.avatar ?? signup.discordAvatarHash ?? null,
  });
  return PublicSignupResponseSchema.parse({
    id: signup.id,
    eventId: signup.eventId,
    user,
    signedUpAt: signup.signedUpAt,
    characterId: signup.characterId,
    character: signup.character,
    confirmationStatus: signup.confirmationStatus,
    status: signup.status,
    preferredRoles: signup.preferredRoles,
    isAnonymous: signup.isAnonymous,
    discordUsername: signup.discordUsername,
    assignedSlot: signup.assignedSlot,
  });
}

export function toPublicRoster(roster: EventRosterDto): PublicEventRosterDto {
  return PublicEventRosterSchema.parse({
    eventId: roster.eventId,
    signups: roster.signups.map(toPublicSignup),
    count: roster.count,
  });
}

export function toPublicRosterAssignment(
  a: RosterAssignmentResponse,
): PublicRosterAssignmentResponse {
  return PublicRosterAssignmentResponseSchema.parse({
    id: a.id,
    signupId: a.signupId,
    userId: a.userId,
    username: a.username,
    avatar: discordAvatarUrl(a.discordId, a.avatar),
    customAvatarUrl: a.customAvatarUrl,
    slot: a.slot,
    position: a.position,
    isOverride: a.isOverride,
    character: a.character,
    preferredRoles: a.preferredRoles,
    signupStatus: a.signupStatus,
  });
}

export function toPublicRosterWithAssignments(
  r: RosterWithAssignments,
): PublicRosterWithAssignments {
  return PublicRosterWithAssignmentsSchema.parse({
    eventId: r.eventId,
    pool: r.pool.map(toPublicRosterAssignment),
    assignments: r.assignments.map(toPublicRosterAssignment),
    slots: r.slots,
  });
}

export function toPublicCreator(c: EventCreatorDto): PublicEventCreatorDto {
  return PublicEventCreatorSchema.parse({
    id: c.id,
    username: c.username,
    avatar: discordAvatarUrl(c.discordId, c.avatar),
    customAvatarUrl: c.customAvatarUrl,
  });
}

/**
 * `GET /events`, `GET /events/:id`: project creator + signups preview. The rest
 * of the event carries no member identity, so it is passed through rather than
 * re-validated field-by-field on the public list path.
 */
export function projectEventForViewer(
  event: EventResponseDto,
  isMember: boolean,
): EventResponseDto | PublicEventResponseDto {
  if (isMember) return event;
  const { signupsPreview, ...rest } = event;
  return {
    ...rest,
    creator: toPublicCreator(event.creator),
    ...(signupsPreview
      ? { signupsPreview: signupsPreview.map(toPublicSignupUser) }
      : {}),
  };
}

/** `GET /events/:id/roster`. */
export function projectRosterForViewer(
  roster: EventRosterDto,
  isMember: boolean,
): EventRosterDto | PublicEventRosterDto {
  return isMember ? roster : toPublicRoster(roster);
}

/** `GET /events/:id/roster/assignments`. */
export function projectRosterWithAssignmentsForViewer(
  r: RosterWithAssignments,
  isMember: boolean,
): RosterWithAssignments | PublicRosterWithAssignments {
  return isMember ? r : toPublicRosterWithAssignments(r);
}

/** `GET /events/:id/detail` bundle — the same projection as the standalone routes. */
export function projectEventDetailForViewer(
  detail: EventDetailResponseDto,
  isMember: boolean,
): EventDetailResponseDto | PublicEventDetailResponseDto {
  if (isMember) return detail;
  return {
    ...detail,
    event: projectEventForViewer(detail.event, false),
    roster: toPublicRoster(detail.roster),
    rosterAssignments: toPublicRosterWithAssignments(detail.rosterAssignments),
  };
}

/**
 * Roster/response building standalone helpers for SignupsService.
 * Contains signup response builders, roster identity, and cancel status logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import * as schema from '../drizzle/schema';
import type {
  SignupResponseDto,
  ConfirmationStatus,
  SignupStatus,
  RosterRole,
  RosterAssignmentResponse,
  SignupCharacterDto,
  AttendanceStatus,
} from '@raid-ledger/contract';

type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect | null;
type CharacterRow = typeof schema.characters.$inferSelect | null;

export function buildRosterIdentity(row: {
  event_signups: SignupRow;
  users: UserRow;
}) {
  const isAnonymous = !row.event_signups.userId;
  return {
    userId: row.users?.id ?? 0,
    discordId: isAnonymous
      ? (row.event_signups.discordUserId ?? '')
      : (row.users?.discordId ?? ''),
    username: isAnonymous
      ? (row.event_signups.discordUsername ?? 'Discord User')
      : (row.users?.username ?? 'Unknown'),
    avatar: isAnonymous
      ? (row.event_signups.discordAvatarHash ?? null)
      : (row.users?.avatar ?? null),
    customAvatarUrl: row.users?.customAvatarUrl ?? null,
  };
}

export function buildRosterCharacter(characters: CharacterRow) {
  if (!characters) return null;
  return {
    id: characters.id,
    name: characters.name,
    className: characters.class,
    role: characters.roleOverride ?? characters.role,
    avatarUrl: characters.avatarUrl,
  };
}

/** Determine cancel status from time until event start. */
export function determineCancelStatus(eventDuration: [Date, Date] | null): {
  cancelStatus: 'declined' | 'roached_out';
  isGracefulDecline: boolean;
  now: Date;
} {
  const now = new Date();
  const eventStartTime = eventDuration?.[0];
  const hoursUntilEvent = eventStartTime
    ? (eventStartTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    : 0;
  const isGracefulDecline = hoursUntilEvent >= 23;
  const cancelStatus = isGracefulDecline ? 'declined' : 'roached_out';
  return { cancelStatus, isGracefulDecline, now };
}

export function formatRoleLabel(r: string): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** Build character DTO for signup response. */
export function buildCharacterDto(
  character: typeof schema.characters.$inferSelect,
): SignupCharacterDto {
  const roleOverride = character.roleOverride as
    | 'tank'
    | 'healer'
    | 'dps'
    | null;
  const role = character.role as 'tank' | 'healer' | 'dps' | null;
  return {
    id: character.id,
    name: character.name,
    class: character.class,
    spec: character.spec,
    role: roleOverride ?? role,
    isMain: character.isMain,
    itemLevel: character.itemLevel,
    level: character.level,
    avatarUrl: character.avatarUrl,
    race: character.race,
    faction: character.faction as 'alliance' | 'horde' | null,
  };
}

/** Build signup response from signup, user, and optional character data. */
export function buildSignupResponseDto(
  signup: typeof schema.eventSignups.$inferSelect,
  user: typeof schema.users.$inferSelect | undefined,
  character: typeof schema.characters.$inferSelect | null,
  assignedSlot?: string,
): SignupResponseDto {
  return {
    id: signup.id,
    eventId: signup.eventId,
    user: {
      id: user?.id ?? 0,
      discordId: user?.discordId ?? '',
      username: user?.username ?? 'Unknown',
      avatar: user?.avatar ?? null,
    },
    note: signup.note,
    signedUpAt: signup.signedUpAt.toISOString(),
    characterId: signup.characterId,
    character: character ? buildCharacterDto(character) : null,
    confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
    status: (signup.status as SignupStatus) ?? 'signed_up',
    preferredRoles:
      (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
    attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
    attendanceRecordedAt: signup.attendanceRecordedAt?.toISOString() ?? null,
    ...(assignedSlot ? { assignedSlot: assignedSlot as RosterRole } : {}),
  };
}

/** Build signup response for anonymous Discord participants (ROK-137). */
export function buildAnonymousSignupResponseDto(
  signup: typeof schema.eventSignups.$inferSelect,
  assignedSlot?: string,
): SignupResponseDto {
  return {
    id: signup.id,
    eventId: signup.eventId,
    user: {
      id: 0,
      discordId: signup.discordUserId ?? '',
      username: signup.discordUsername ?? 'Discord User',
      avatar: null,
    },
    note: signup.note,
    signedUpAt: signup.signedUpAt.toISOString(),
    characterId: null,
    character: null,
    confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
    status: (signup.status as SignupStatus) ?? 'signed_up',
    isAnonymous: true,
    discordUserId: signup.discordUserId,
    discordUsername: signup.discordUsername,
    discordAvatarHash: signup.discordAvatarHash,
    preferredRoles:
      (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
    attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
    attendanceRecordedAt: signup.attendanceRecordedAt?.toISOString() ?? null,
    ...(assignedSlot ? { assignedSlot: assignedSlot as RosterRole } : {}),
  };
}

/** Build roster assignment response from signup data. */
export function buildRosterAssignmentResponseDto(
  row: {
    event_signups: typeof schema.eventSignups.$inferSelect;
    users: typeof schema.users.$inferSelect | null;
    characters: typeof schema.characters.$inferSelect | null;
  },
  assignment?: typeof schema.rosterAssignments.$inferSelect,
): RosterAssignmentResponse {
  const identity = buildRosterIdentity(row);
  return {
    id: assignment?.id ?? 0,
    signupId: row.event_signups.id,
    ...identity,
    slot: (assignment?.role as RosterRole) ?? null,
    position: assignment?.position ?? 0,
    isOverride: assignment?.isOverride === 1,
    character: buildRosterCharacter(row.characters),
    preferredRoles:
      (row.event_signups.preferredRoles as
        | ('tank' | 'healer' | 'dps')[]
        | null) ?? null,
    signupStatus: row.event_signups.status as
      | 'signed_up'
      | 'tentative'
      | 'declined',
  };
}

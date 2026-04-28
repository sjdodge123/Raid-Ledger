import type {
  SignupResponseDto,
  SignupCharacterDto,
  CharacterProfessionsDto,
  ConfirmationStatus,
  SignupStatus,
  RosterRole,
  RosterAssignmentResponse,
  AttendanceStatus,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type CharacterRow = typeof schema.characters.$inferSelect;
type AssignmentRow = typeof schema.rosterAssignments.$inferSelect;

export function buildCharacterDto(character: CharacterRow): SignupCharacterDto {
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
    professions: (character.professions as CharacterProfessionsDto | null) ?? null,
  };
}

export function buildSignupResponse(
  signup: SignupRow,
  user: UserRow | undefined,
  character: CharacterRow | null,
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
  };
}

export function buildAnonymousSignupResponse(
  signup: SignupRow,
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
  };
}

type RosterRow = {
  event_signups: SignupRow;
  users: UserRow | null;
  characters: CharacterRow | null;
};

function buildRosterIdentity(row: RosterRow) {
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

function buildRosterCharacter(characters: CharacterRow | null) {
  if (!characters) return null;
  return {
    id: characters.id,
    name: characters.name,
    className: characters.class,
    role: characters.roleOverride ?? characters.role,
    avatarUrl: characters.avatarUrl,
  };
}

export function buildRosterAssignmentResponse(
  row: RosterRow,
  assignment?: AssignmentRow,
): RosterAssignmentResponse {
  return {
    id: assignment?.id ?? 0,
    signupId: row.event_signups.id,
    ...buildRosterIdentity(row),
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

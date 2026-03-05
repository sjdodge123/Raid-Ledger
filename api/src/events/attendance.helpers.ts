import type {
  AttendanceStatus,
  SignupResponseDto,
  ConfirmationStatus,
  SignupStatus,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { buildCharacterDto } from './signup-response.helpers';

type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type CharacterRow = typeof schema.characters.$inferSelect;

export function resolveAttendanceStatus(
  signup: SignupRow,
  eventStartTime: Date | undefined,
): AttendanceStatus | null {
  const existing = (signup.attendanceStatus as AttendanceStatus) ?? null;
  if (existing) return existing;

  if (signup.status === 'declined') return 'excused';
  if (signup.status === 'departed') return 'attended';
  if (signup.status === 'roached_out') {
    return resolveRoachedOutStatus(signup.roachedOutAt, eventStartTime);
  }
  return null;
}

function resolveRoachedOutStatus(
  roachedAt: Date | null,
  eventStartTime: Date | undefined,
): AttendanceStatus {
  if (!roachedAt || !eventStartTime) return 'excused';
  const hoursBeforeEvent =
    (eventStartTime.getTime() - roachedAt.getTime()) / (1000 * 60 * 60);
  return hoursBeforeEvent >= 24 ? 'excused' : 'no_show';
}

type AttendanceRow = {
  event_signups: SignupRow;
  users: UserRow | null;
  characters: CharacterRow | null;
};

function buildUserField(s: SignupRow, users: UserRow | null) {
  if (!s.userId) {
    return {
      id: 0,
      discordId: s.discordUserId ?? '',
      username: s.discordUsername ?? 'Discord User',
      avatar: null,
    };
  }
  return {
    id: users?.id ?? 0,
    discordId: users?.discordId ?? '',
    username: users?.username ?? 'Unknown',
    avatar: users?.avatar ?? null,
  };
}

function anonymousFields(s: SignupRow) {
  if (!s.userId) {
    return {
      isAnonymous: true as const,
      discordUserId: s.discordUserId,
      discordUsername: s.discordUsername,
      discordAvatarHash: s.discordAvatarHash,
    };
  }
  return {};
}

export function buildAttendanceSignupResponse(
  row: AttendanceRow,
  resolvedAttendance: AttendanceStatus | null,
): SignupResponseDto {
  const s = row.event_signups;
  const isAnonymous = !s.userId;
  return {
    id: s.id,
    eventId: s.eventId,
    user: buildUserField(s, row.users),
    note: s.note,
    signedUpAt: s.signedUpAt.toISOString(),
    characterId: isAnonymous ? null : s.characterId,
    character:
      !isAnonymous && row.characters ? buildCharacterDto(row.characters) : null,
    confirmationStatus: s.confirmationStatus as ConfirmationStatus,
    status: (s.status as SignupStatus) ?? 'signed_up',
    ...anonymousFields(s),
    preferredRoles:
      (s.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
    attendanceStatus: resolvedAttendance,
    attendanceRecordedAt: s.attendanceRecordedAt?.toISOString() ?? null,
  };
}

export function computeAttendanceSummary(
  eventId: number,
  signupResponses: SignupResponseDto[],
) {
  const total = signupResponses.length;
  const attended = signupResponses.filter(
    (s) => s.attendanceStatus === 'attended',
  ).length;
  const noShow = signupResponses.filter(
    (s) => s.attendanceStatus === 'no_show',
  ).length;
  const excused = signupResponses.filter(
    (s) => s.attendanceStatus === 'excused',
  ).length;
  const markedTotal = attended + noShow + excused;
  return {
    eventId,
    totalSignups: total,
    attended,
    noShow,
    excused,
    unmarked: total - markedTotal,
    attendanceRate:
      markedTotal > 0 ? Math.round((attended / markedTotal) * 100) / 100 : 0,
    noShowRate:
      markedTotal > 0 ? Math.round((noShow / markedTotal) * 100) / 100 : 0,
    signups: signupResponses,
  };
}

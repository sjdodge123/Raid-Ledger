import type { UserManagementDto } from '@raid-ledger/contract';

/**
 * Shape of a single user-management row coming back from the DB:
 * either the paginated list (raw rows from `findAllWithRolesQuery`) or
 * the single-user reactivate response (`reactivateUser` returning a Drizzle row).
 */
export interface UserManagementRow {
  id: number;
  username: string;
  avatar: string | null;
  customAvatarUrl: string | null;
  role: 'member' | 'operator' | 'admin';
  createdAt: Date | string;
  deactivatedAt?: Date | string | null;
  discordId?: string | null;
  kickedAt?: Date | string | null;
  bannedAt?: Date | string | null;
}

/** Normalise a nullable Date|string timestamp to an ISO string (or null). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

/** Map a raw row to the contract DTO with ISO-string timestamps. */
export function mapManagementRow(row: UserManagementRow): UserManagementDto {
  const createdAt =
    typeof row.createdAt === 'string'
      ? row.createdAt
      : row.createdAt.toISOString();
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    customAvatarUrl: row.customAvatarUrl,
    role: row.role,
    createdAt,
    deactivatedAt: toIso(row.deactivatedAt),
    discordId: row.discordId ?? null,
    kickedAt: toIso(row.kickedAt),
    bannedAt: toIso(row.bannedAt),
  };
}

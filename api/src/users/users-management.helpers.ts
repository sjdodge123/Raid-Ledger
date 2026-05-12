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
}

/** Map a raw row to the contract DTO with ISO-string timestamps. */
export function mapManagementRow(row: UserManagementRow): UserManagementDto {
  const createdAt =
    typeof row.createdAt === 'string'
      ? row.createdAt
      : row.createdAt.toISOString();
  const deactivatedAt =
    row.deactivatedAt == null
      ? null
      : typeof row.deactivatedAt === 'string'
        ? row.deactivatedAt
        : row.deactivatedAt.toISOString();
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    customAvatarUrl: row.customAvatarUrl,
    role: row.role,
    createdAt,
    deactivatedAt,
  };
}

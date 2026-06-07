import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROK-1353: long-lived refresh tokens for rotation-based sessions.
 *
 * Only the SHA-256 hash of the raw token is stored — the raw value lives
 * exclusively in the httpOnly `rl_rt` cookie. Rows form a rotation "family"
 * (shared `family_id`): each successful refresh consumes the presented row
 * (`rotated_at` + `replaced_by`) and mints a child. Reuse of a consumed row
 * revokes the whole family. Logout/deactivation set `revoked_at`.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** SHA-256 hex of the raw token. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Rotation lineage — all rows from one login share this. */
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Set when the row is consumed by a successful rotation. */
    rotatedAt: timestamp('rotated_at'),
    /** Set on logout / deactivation / reuse-detection. */
    revokedAt: timestamp('revoked_at'),
    /** The child row that replaced this one in the family. */
    replacedBy: uuid('replaced_by'),
    userAgent: text('user_agent'),
    /** 'discord' | 'local' | 'magic'. */
    authMethod: text('auth_method').notNull(),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_expires_at').on(table.expiresAt),
    index('idx_refresh_tokens_family_id').on(table.familyId),
  ],
);

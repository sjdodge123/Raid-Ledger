import {
  pgTable,
  serial,
  integer,
  text,
  char,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROK-2263: one row per minted backup-export token (`rlbx_`). The token
 * authorises ONLY listing, creating and downloading backups. Only the sha256
 * hex hash is stored; the raw token exists only in the mint response.
 * `token_hint` (last 4 chars) is display-only. Revoke stamps `revoked_at`
 * (soft). `expires_at` NULL = never expires. Row data is excluded from every
 * dump (backup.service SANITIZED_EXCLUDED_TABLES). Never log the hash.
 */
export const backupExportTokens = pgTable(
  'backup_export_tokens',
  {
    id: serial('id').primaryKey(),
    label: text('label').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    tokenHint: text('token_hint').notNull(),
    /** The admin who minted it; their deletion deletes the token. */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** NULL = never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Stamped at most once per 60 s per token. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIpCoarse: text('last_used_ip_coarse'),
    /** NULL = live. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // Backs the users FK (fk-index-coverage.spec.ts).
    index('backup_export_tokens_created_by_idx').on(t.createdBy),
  ],
);

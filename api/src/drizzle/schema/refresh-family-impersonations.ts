import { pgTable, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROK-1754: server-side impersonation marker, keyed by refresh family.
 *
 * While a row is live, `/auth/refresh` on that family mints the TARGET's
 * access token instead of the admin's, so impersonation survives reloads and
 * new tabs without the browser ever holding an admin token. One row per
 * family (PK); `family_id` has no FK because it is not unique in
 * `refresh_tokens`. `expires_at` is absolute (started_at + 1h), never slid.
 */
export const refreshFamilyImpersonations = pgTable(
  'refresh_family_impersonations',
  {
    familyId: uuid('family_id').primaryKey(),
    /** Always the family's `user_id`; kept for audit + an equality check. */
    impersonatorUserId: integer('impersonator_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    targetUserId: integer('target_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    index('idx_refresh_family_impersonations_impersonator').on(
      table.impersonatorUserId,
    ),
    index('idx_refresh_family_impersonations_target').on(table.targetUserId),
    index('idx_refresh_family_impersonations_expires_at').on(table.expiresAt),
  ],
);

export type RefreshFamilyImpersonation =
  typeof refreshFamilyImpersonations.$inferSelect;
export type NewRefreshFamilyImpersonation =
  typeof refreshFamilyImpersonations.$inferInsert;

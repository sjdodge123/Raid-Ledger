import {
  pgTable,
  serial,
  integer,
  uuid,
  varchar,
  boolean,
  timestamp,
  char,
  smallint,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { characters } from './characters';

/**
 * ROK-1724: one row per WoW addon import attempt (preview, apply or reject) —
 * plugin-owned. Also the source of the per-user hourly limits: a count over
 * (user_id, created_at). Not `activity_log`: a reject has no stable entity.
 */
export const addonImportAudit = pgTable(
  'addon_import_audit',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /** Null when the header never parsed. */
    section: varchar('section', { length: 10 }),
    /** Null when the payload never decoded. */
    payloadSha256: char('payload_sha256', { length: 64 }),
    /** Length of the submitted import string. */
    sizeBytes: integer('size_bytes').notNull(),
    dryRun: boolean('dry_run').notNull(),
    /** preview | applied | noop | stale | <AddonImportErrorCode> */
    result: varchar('result', { length: 32 }).notNull(),
    /**
     * ROK-2184: the paste's `!RLn!` envelope version — sniffed from the
     * header before decoding (so a reject records what was pasted), then the
     * decoded paste's version. NULL = unknown: the header never parsed, or
     * the row predates this column (only v1 was accepted then → count as v1).
     *
     * v1 retirement check (ruling Q7, third condition: no accepted `!RL1!`
     * import for 30 days). "Accepted" = COMMITTED imports only — no previews,
     * no `stale`. v1 can retire once `v1_accepts_30d` is 0:
     *
     *   SELECT max(created_at) AS last_v1_accept, count(*) AS v1_accepts_30d
     *   FROM addon_import_audit
     *   WHERE coalesce(envelope_version, 1) = 1
     *     AND dry_run = false
     *     AND result IN ('applied', 'noop')
     *     AND created_at >= now() - interval '30 days';
     */
    envelopeVersion: smallint('envelope_version'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** The per-user hourly limit count; also backs the user_id FK. */
    index('idx_addon_import_audit_user_created_at').on(
      table.userId,
      table.createdAt,
    ),
    // ROK-1157: FK backing index (parent delete / RI scan)
    index('idx_addon_import_audit_character_id').on(table.characterId),
  ],
);

export type AddonImportAuditInsert = typeof addonImportAudit.$inferInsert;
export type AddonImportAuditSelect = typeof addonImportAudit.$inferSelect;

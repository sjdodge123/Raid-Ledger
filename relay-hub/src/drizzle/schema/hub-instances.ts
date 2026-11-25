import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Lifecycle of a registered Raid Ledger instance (ROK-1671). */
export const HUB_INSTANCE_STATUSES = [
  'pending',
  'approved',
  'revoked',
  'disconnected',
] as const;

export type HubInstanceStatus = (typeof HUB_INSTANCE_STATUSES)[number];

/**
 * One row per instance. Only the SHA-256 of its `rlh_` token is stored (L6);
 * `token_hash` is nullable so RH-3b's DELETE can clear it (L5). No IP, user
 * agent or usage stats (L10).
 */
export const hubInstances = pgTable(
  'hub_instances',
  {
    instanceId: uuid('instance_id').primaryKey(),
    tokenHash: text('token_hash').unique(),
    status: text('status').$type<HubInstanceStatus>().notNull(),
    trustTier: text('trust_tier').notNull().default('reader'),
    version: text('version').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    check(
      'hub_instances_status_check',
      sql`${t.status} in ('pending', 'approved', 'revoked', 'disconnected')`,
    ),
  ],
);

export type HubInstanceRow = typeof hubInstances.$inferSelect;

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/** The only scope a companion device token carries in v1. */
export const COMPANION_DEVICE_SCOPE = 'companion:ingest';

/**
 * ROK-1955: one row per linked Companion device (an issued `rlcd_` token).
 * Only the sha256 hex hash is stored; the raw token exists only in the
 * winning poll's response. `token_hint` (last 4 chars) is display-only.
 * Revoke stamps `revoked_at` (soft — the list hides rows after 30 days).
 * Only coarse networks are stored (IPv4 /24, IPv6 /48). Never log the hash.
 */
export const companionDevices = pgTable(
  'companion_devices',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    os: text('os'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    tokenHash: text('token_hash').notNull().unique(),
    tokenHint: text('token_hint').notNull(),
    scope: text('scope').notNull().default(COMPANION_DEVICE_SCOPE),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Stamped at most once per 60 s per device. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIpCoarse: text('last_used_ip_coarse'),
    /** NULL = live. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // Backs the users FK (fk-index-coverage.spec.ts) and the owner list.
    index('companion_devices_user_id_idx').on(t.userId),
    check('companion_devices_scope_chk', sql`${t.scope} = 'companion:ingest'`),
  ],
);

/**
 * ROK-1955: RFC 8628 device-authorization grants (pending links). Both codes
 * are stored as sha256 hex only — a DB read cannot approve or poll someone
 * else's link. `expired` is derived from `expires_at`, never stored. The
 * token is minted at the winning `approved → consumed` poll, which sets
 * `device_id`. Rows 24 h past `expires_at` are deleted by a cleanup cron.
 */
export const companionDeviceLinks = pgTable(
  'companion_device_links',
  {
    id: serial('id').primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    /** sha256 hex of the normalised 8-char code. */
    userCodeHash: text('user_code_hash').notNull(),
    status: text('status').notNull(),
    deviceName: text('device_name'),
    deviceOs: text('device_os'),
    deviceOsVersion: text('device_os_version'),
    appVersion: text('app_version'),
    requestedIpCoarse: text('requested_ip_coarse'),
    /** Grows by 5 s on each `slow_down`. */
    intervalSec: integer('interval_sec').notNull().default(5),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Approver or denier. */
    decidedBy: integer('decided_by').references(() => users.id, {
      onDelete: 'cascade',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Set when the approved link is consumed. */
    deviceId: integer('device_id').references(() => companionDevices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // No two live links share a code; the generator retries on conflict.
    uniqueIndex('companion_device_links_user_code_pending_uq')
      .on(t.userCodeHash)
      .where(sql`${t.status} = 'pending'`),
    // FK coverage (fk-index-coverage.spec.ts).
    index('companion_device_links_decided_by_idx').on(t.decidedBy),
    index('companion_device_links_device_id_idx').on(t.deviceId),
    // Cleanup cron scan.
    index('companion_device_links_expires_at_idx').on(t.expiresAt),
    check(
      'companion_device_links_status_chk',
      sql`${t.status} IN ('pending','approved','denied','consumed')`,
    ),
  ],
);

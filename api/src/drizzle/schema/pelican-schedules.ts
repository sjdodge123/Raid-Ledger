import {
  pgTable,
  bigserial,
  integer,
  text,
  boolean,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pelicanServers } from './pelican-servers';

/**
 * ROK-1772 (Pelican S3a): plugin-owned (Pelican). Mirrors a server's Pelican
 * schedules. Created in S3a, written by S3b (ROK-1773).
 *
 * SECURITY: no payload or command column — schedule task payloads (console
 * commands) never reach the DB; only the derived `effect` does.
 * `pelican-tables.schema.spec.ts` pins the column set.
 */
export const pelicanSchedules = pgTable(
  'pelican_schedules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    serverId: integer('server_id')
      .notNull()
      .references(() => pelicanServers.id, { onDelete: 'cascade' }),
    panelScheduleId: integer('panel_schedule_id').notNull(),
    name: text('name').notNull(),
    cronMinute: text('cron_minute').notNull(),
    cronHour: text('cron_hour').notNull(),
    cronDayOfMonth: text('cron_day_of_month').notNull(),
    cronMonth: text('cron_month').notNull(),
    cronDayOfWeek: text('cron_day_of_week').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    onlyWhenOnline: boolean('only_when_online').notNull().default(false),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** Mirrors `GameServerEffectSchema` in the contract. */
    effect: text('effect').notNull(),
    effectOffsetS: integer('effect_offset_s').notNull().default(0),
  },
  (t) => [
    // Leading server_id also backs the pelican_servers FK
    // (fk-index-coverage.spec.ts counts unique-constraint leading columns).
    unique('pelican_schedules_server_panel_uq').on(
      t.serverId,
      t.panelScheduleId,
    ),
    check(
      'pelican_schedules_effect_chk',
      sql`${t.effect} IN ('restart','stop','start','kill','backup','command','mixed')`,
    ),
    check(
      'pelican_schedules_effect_offset_chk',
      sql`${t.effectOffsetS} BETWEEN 0 AND 900`,
    ),
  ],
);

export type PelicanScheduleRow = typeof pelicanSchedules.$inferSelect;
export type NewPelicanSchedule = typeof pelicanSchedules.$inferInsert;

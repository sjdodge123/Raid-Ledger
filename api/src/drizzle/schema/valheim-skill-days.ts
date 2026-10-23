import {
  pgTable,
  bigserial,
  integer,
  date,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import type { ValheimSkill } from '@raid-ledger/contract';
import { valheimProfiles } from './valheim-armory';
import { tsz } from './valheim-columns';

/**
 * ROK-1882: one row per character per PLAY day (the game server's timezone,
 * falling back to the community default, then UTC). Stores the raw
 * `{id, level, accumulator}` skills before the day's first import and after
 * its latest one, so the trend formula can change without a backfill.
 * The importer keeps the newest 10 play days per profile.
 */
export const valheimProfileSkillDays = pgTable(
  'valheim_profile_skill_days',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => valheimProfiles.id, { onDelete: 'cascade' }),
    /** The bucket date, literal `YYYY-MM-DD` — never parsed through `Date`. */
    playDate: date('play_date', { mode: 'string' }).notNull(),
    firstSeenAt: tsz('first_seen_at').notNull(),
    lastSeenAt: tsz('last_seen_at').notNull(),
    startSkills: jsonb('start_skills').$type<ValheimSkill[]>().notNull(),
    endSkills: jsonb('end_skills').$type<ValheimSkill[]>().notNull(),
  },
  (t) => [
    // Also backs the profile FK and the newest-N read.
    unique('valheim_profile_skill_days_profile_date_uq').on(
      t.profileId,
      t.playDate,
    ),
  ],
);

export type ValheimProfileSkillDayRow =
  typeof valheimProfileSkillDays.$inferSelect;
export type NewValheimProfileSkillDay =
  typeof valheimProfileSkillDays.$inferInsert;

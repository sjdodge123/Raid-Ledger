import {
  pgTable,
  integer,
  uuid,
  text,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lfgIntents } from './lfg-intents';
import { characters } from './characters';

/**
 * WoW LFG per-hand detail (ROK-2352) — owned by the WoW plugin; core never
 * reads it. One row per raised hand in a keyed WoW group: the roles the
 * player will fill and, optionally, the character they bring.
 *
 * The hand is the key, so the row dies with it (CASCADE). A deleted character
 * only forgets the pick (SET NULL) — the hand and its roles stay.
 */
export const wowLfgHandDetails = pgTable(
  'wow_lfg_hand_details',
  {
    intentId: integer('intent_id')
      .primaryKey()
      .references(() => lfgIntents.id, { onDelete: 'cascade' }),
    /** 1..3 of `tank` | `healer` | `dps` (DB CHECK). */
    roles: text('roles').array().notNull(),
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'wow_lfg_hand_details_roles_check',
      sql`${table.roles} <@ ARRAY['tank', 'healer', 'dps']::text[] AND cardinality(${table.roles}) between 1 and 3`,
    ),
    // FK backing index (character delete → SET NULL scan; fk-index-coverage).
    index('idx_wow_lfg_hand_details_character_id').on(table.characterId),
  ],
);

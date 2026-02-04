import {
  pgTable,
  serial,
  text,
  timestamp,
  customType,
  integer,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { gameRegistry } from './game-registry';

// Define custom tsrange type
export const tsrange = customType<{
  data: [Date, Date];
  driverData: string;
}>({
  dataType() {
    return 'tsrange';
  },
  // Parsing from DB driver (string "[2026-01-01 10:00:00, 2026-01-01 11:00:00)") to JS Date tuple
  fromDriver(value: string) {
    if (!value || value === 'empty') return [new Date(0), new Date(0)];
    // Basic parsing logic for Postgres range syntax
    const matches = value.match(/[[(]([^,]+),([^,]+)[)\]]/);
    if (!matches) return [new Date(0), new Date(0)];
    return [
      new Date(matches[1].replace(/"/g, '')),
      new Date(matches[2].replace(/"/g, '')),
    ];
  },
  // Formatting JS Date tuple to DB driver string
  toDriver(value: [Date, Date]) {
    return `[${value[0].toISOString()},${value[1].toISOString()})`;
  },
});

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  gameId: text('game_id'), // Reference to IGDB (legacy)
  /** Reference to game registry for game-specific configuration (nullable for backward compatibility) */
  registryGameId: uuid('registry_game_id').references(() => gameRegistry.id),
  creatorId: integer('creator_id')
    .references(() => users.id)
    .notNull(),
  // Utilizing tsrange for efficient scheduling and overlap checks
  duration: tsrange('duration').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

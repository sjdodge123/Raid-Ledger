import { pgTable, serial, integer, varchar, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * User preferences table (ROK-195)
 * Stores user-specific preferences like selected avatar, theme, timezone, etc.
 * Uses key-value pattern with JSONB for flexibility
 */
export const userPreferences = pgTable(
    'user_preferences',
    {
        id: serial('id').primaryKey(),
        userId: integer('user_id')
            .references(() => users.id, { onDelete: 'cascade' })
            .notNull(),
        /** Preference key (e.g., 'selected_avatar', 'theme', 'timezone') */
        key: varchar('key', { length: 100 }).notNull(),
        /** Preference value stored as JSON */
        value: jsonb('value').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => ({
        /** Each user can only have one value per preference key */
        uniqueUserKey: unique('unique_user_preference_key').on(table.userId, table.key),
    }),
);

// Type inference helpers
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;

/**
 * Type definitions for known preference values
 */
export type SelectedAvatarPreference = {
    type: 'discord' | 'character';
    characterId?: string;
};

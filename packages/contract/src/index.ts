import { z } from 'zod';

export const HealthCheckSchema = z.object({
    status: z.string(),
    timestamp: z.string()
});

export type HealthCheckDto = z.infer<typeof HealthCheckSchema>;

// Games / IGDB
export * from './games.schema.js';

// Game Registry (multi-game support)
export * from './game-registry.schema.js';

// Events
export * from './events.schema.js';

// Signups
export * from './signups.schema.js';

// Characters
export * from './characters.schema.js';

// Availability
export * from './availability.schema.js';

// Roster Availability (heatmap)
export * from './roster-availability.schema.js';

// Roster Assignments (ROK-114)
export * from './roster.schema.js';

// System Status (ROK-175)
export * from './system.schema.js';

// Users (ROK-181)
export * from './users.schema.js';

// User Preferences (ROK-195)
export * from './preferences.schema.js';

// Game Time Templates (ROK-189)
export * from './game-time.schema.js';

// Admin (ROK-193)
export * from './admin.schema.js';

// Event Templates
export * from './templates.schema.js';

// Blizzard Instance Data
export * from './blizzard.schema.js';

// Plugins (ROK-236)
export * from './plugins.schema.js';

// Feedback (ROK-186)
export * from './feedback.schema.js';

// PUG Slots (ROK-262)
export * from './pug.schema.js';

// Admin Onboarding Wizard (ROK-204)
export * from './onboarding.schema.js';

// Version & Update Check (ROK-294)
export * from './version.schema.js';

// Discord Bot (ROK-117)
export * from './discord-bot.schema.js';

// Channel Bindings (ROK-348)
export * from './channel-bindings.schema.js';

// Auth (ROK-389)
export * from './auth.schema.js';

// Backups
export * from './backup.schema.js';

// Event Plans (ROK-392)
export * from './event-plans.schema.js';

// Dungeon Quests (ROK-245)
export * from './dungeon-quests.schema.js';

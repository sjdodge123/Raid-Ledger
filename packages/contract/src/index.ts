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

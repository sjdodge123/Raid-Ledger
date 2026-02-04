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

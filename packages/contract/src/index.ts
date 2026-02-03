import { z } from 'zod';

export const HealthCheckSchema = z.object({
    status: z.string(),
    timestamp: z.string()
});

export type HealthCheckDto = z.infer<typeof HealthCheckSchema>;

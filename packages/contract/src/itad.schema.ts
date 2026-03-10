import { z } from 'zod';

// ==========================================
// ITAD Integration (ROK-772)
// ==========================================

/**
 * Admin ITAD configuration status.
 */
export const ItadConfigStatusSchema = z.object({
  configured: z.boolean(),
});

export type ItadConfigStatusDto = z.infer<typeof ItadConfigStatusSchema>;

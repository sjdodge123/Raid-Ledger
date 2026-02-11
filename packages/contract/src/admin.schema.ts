import { z } from 'zod';

/**
 * Demo Data schemas (ROK-193)
 * Shared types for the admin demo data install/delete feature.
 */

export const DemoDataCountsSchema = z.object({
  users: z.number(),
  events: z.number(),
  characters: z.number(),
  signups: z.number(),
  availability: z.number(),
  gameTimeSlots: z.number(),
  notifications: z.number(),
});

export type DemoDataCountsDto = z.infer<typeof DemoDataCountsSchema>;

export const DemoDataStatusSchema = DemoDataCountsSchema.extend({
  demoMode: z.boolean(),
});

export type DemoDataStatusDto = z.infer<typeof DemoDataStatusSchema>;

export const DemoDataResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  counts: DemoDataCountsSchema,
});

export type DemoDataResultDto = z.infer<typeof DemoDataResultSchema>;

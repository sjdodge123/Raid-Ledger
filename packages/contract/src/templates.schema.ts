import { z } from 'zod';
import { SlotConfigSchema, RecurrenceSchema } from './events.schema.js';

/** Template config stores all form fields that can be templated */
export const TemplateConfigSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    gameId: z.number().int().positive().optional(),
    durationMinutes: z.number().int().min(1).optional(),
    slotConfig: SlotConfigSchema.optional(),
    maxAttendees: z.number().int().min(1).optional(),
    autoUnbench: z.boolean().optional(),
    recurrence: RecurrenceSchema.optional(),
});

export type TemplateConfigDto = z.infer<typeof TemplateConfigSchema>;

/** Schema for creating a new event template */
export const CreateTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    config: TemplateConfigSchema,
});

export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;

/** Single template response */
export const TemplateResponseSchema = z.object({
    id: z.number(),
    name: z.string(),
    config: TemplateConfigSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type TemplateResponseDto = z.infer<typeof TemplateResponseSchema>;

/** Template list response */
export const TemplateListResponseSchema = z.object({
    data: z.array(TemplateResponseSchema),
});

export type TemplateListResponseDto = z.infer<typeof TemplateListResponseSchema>;

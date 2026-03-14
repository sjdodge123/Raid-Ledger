import { z } from 'zod';

/** Schema for an AI model available from a provider. */
export const AiModelSchema = z.object({
    id: z.string(),
    name: z.string(),
    parameterSize: z.string().optional(),
    quantization: z.string().optional(),
    family: z.string().optional(),
});

export type AiModelDto = z.infer<typeof AiModelSchema>;

/** Schema for the AI provider status response. */
export const AiStatusSchema = z.object({
    provider: z.string(),
    providerName: z.string(),
    available: z.boolean(),
    currentModel: z.string().nullable(),
    selfHosted: z.boolean(),
    dockerStatus: z.enum(['running', 'stopped', 'unknown']),
});

export type AiStatusDto = z.infer<typeof AiStatusSchema>;

/** Per-feature usage breakdown entry. */
export const AiFeatureUsageSchema = z.object({
    feature: z.string(),
    count: z.number(),
    avgLatencyMs: z.number(),
});

export type AiFeatureUsageDto = z.infer<typeof AiFeatureUsageSchema>;

/** Schema for AI usage statistics. */
export const AiUsageSchema = z.object({
    totalRequests: z.number(),
    requestsToday: z.number(),
    avgLatencyMs: z.number(),
    errorRate: z.number(),
    byFeature: z.array(AiFeatureUsageSchema),
});

export type AiUsageDto = z.infer<typeof AiUsageSchema>;

/** Schema for the AI test-connection response. */
export const AiTestConnectionSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    latencyMs: z.number().optional(),
});

export type AiTestConnectionDto = z.infer<typeof AiTestConnectionSchema>;

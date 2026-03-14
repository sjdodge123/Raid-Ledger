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

/** Schema for a single AI provider's info (multi-provider management). */
export const AiProviderInfoSchema = z.object({
    key: z.string(),
    displayName: z.string(),
    requiresApiKey: z.boolean(),
    selfHosted: z.boolean(),
    configured: z.boolean(),
    available: z.boolean(),
    active: z.boolean(),
    setupInProgress: z.boolean().optional(),
});

export type AiProviderInfoDto = z.infer<typeof AiProviderInfoSchema>;

/** Schema for the Ollama Docker setup progress response. */
export const AiOllamaSetupSchema = z.object({
    step: z.enum([
        'checking',
        'pulling_image',
        'starting',
        'pulling_model',
        'ready',
        'error',
    ]),
    message: z.string(),
    success: z.boolean(),
});

export type AiOllamaSetupDto = z.infer<typeof AiOllamaSetupSchema>;

/** Schema for configuring a provider (API key, URL, model). */
export const AiProviderConfigSchema = z.object({
    apiKey: z.string().optional(),
    url: z.string().optional(),
    model: z.string().optional(),
});

export type AiProviderConfigDto = z.infer<typeof AiProviderConfigSchema>;

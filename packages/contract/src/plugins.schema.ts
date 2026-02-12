import { z } from 'zod';

export const PluginAuthorSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
});

export type PluginAuthorDto = z.infer<typeof PluginAuthorSchema>;

export const PluginIntegrationInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  configured: z.boolean(),
  credentialLabels: z.array(z.string()),
});

export type PluginIntegrationInfoDto = z.infer<typeof PluginIntegrationInfoSchema>;

export const PluginInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: PluginAuthorSchema,
  gameSlugs: z.array(z.string()).default([]),
  capabilities: z.array(z.string()),
  integrations: z.array(PluginIntegrationInfoSchema),
  status: z.enum(['not_installed', 'active', 'inactive']),
  installedAt: z.string().datetime().nullable(),
});

export type PluginInfoDto = z.infer<typeof PluginInfoSchema>;

export const PluginListResponseSchema = z.object({
  data: z.array(PluginInfoSchema),
});

export type PluginListResponseDto = z.infer<typeof PluginListResponseSchema>;

import { z } from 'zod';

export const DiscordBotConfigSchema = z.object({
    botToken: z.string().min(1),
    enabled: z.boolean(),
});

export const DiscordBotStatusSchema = z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    guildName: z.string().optional(),
    memberCount: z.number().optional(),
});

export const DiscordBotTestConnectionSchema = z.object({
    botToken: z.string().optional(),
});

export const DiscordBotTestResultSchema = z.object({
    success: z.boolean(),
    guildName: z.string().optional(),
    message: z.string(),
});

export type DiscordBotConfigDto = z.infer<typeof DiscordBotConfigSchema>;
export type DiscordBotTestConnectionDto = z.infer<typeof DiscordBotTestConnectionSchema>;
export type DiscordBotStatusResponse = z.infer<typeof DiscordBotStatusSchema>;
export type DiscordBotTestResult = z.infer<typeof DiscordBotTestResultSchema>;

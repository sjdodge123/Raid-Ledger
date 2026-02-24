import { z } from 'zod';

export const DiscordBotConfigSchema = z.object({
    botToken: z.string().min(1),
    enabled: z.boolean(),
});

export const DiscordBotStatusSchema = z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    enabled: z.boolean().optional(),
    connecting: z.boolean().optional(),
    guildName: z.string().optional(),
    memberCount: z.number().optional(),
    setupCompleted: z.boolean().optional(),
});

export const DiscordBotTestConnectionSchema = z.object({
    botToken: z.string().optional(),
});

export const DiscordBotTestResultSchema = z.object({
    success: z.boolean(),
    guildName: z.string().optional(),
    message: z.string(),
});

/** Response from GET /discord/server-invite (ROK-403) */
export const ServerInviteResponseSchema = z.object({
    url: z.string().nullable(),
    guildName: z.string().nullable(),
});

/** Response from GET /discord/guild-membership (ROK-403) */
export const GuildMembershipResponseSchema = z.object({
    isMember: z.boolean(),
});

/** Query params for GET /admin/settings/discord-bot/members/characters (ROK-428) */
export const DiscordMemberCharactersQuerySchema = z.object({
    discordId: z.string().min(1),
    gameId: z.coerce.number().int().positive(),
});

export type DiscordMemberCharactersQueryDto = z.infer<typeof DiscordMemberCharactersQuerySchema>;

export type DiscordBotConfigDto = z.infer<typeof DiscordBotConfigSchema>;
export type DiscordBotTestConnectionDto = z.infer<typeof DiscordBotTestConnectionSchema>;
export type DiscordBotStatusResponse = z.infer<typeof DiscordBotStatusSchema>;
export type DiscordBotTestResult = z.infer<typeof DiscordBotTestResultSchema>;
export type ServerInviteResponseDto = z.infer<typeof ServerInviteResponseSchema>;
export type GuildMembershipResponseDto = z.infer<typeof GuildMembershipResponseSchema>;

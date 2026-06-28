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
    /** ROK-293: Whether ad-hoc voice channel events are enabled */
    adHocEventsEnabled: z.boolean().optional(),
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

/** ROK-430: Setup status for the Discord Overview dashboard */
export const DiscordSetupStepSchema = z.object({
    key: z.string(),
    label: z.string(),
    completed: z.boolean(),
    settingsPath: z.string(),
});

export const DiscordSetupStatusSchema = z.object({
    steps: z.array(DiscordSetupStepSchema),
    overallComplete: z.boolean(),
    completedCount: z.number(),
    totalCount: z.number(),
});

export type DiscordSetupStep = z.infer<typeof DiscordSetupStepSchema>;
export type DiscordSetupStatus = z.infer<typeof DiscordSetupStatusSchema>;

/** ROK-547: Body for PUT /admin/settings/discord-bot/channel */
export const DiscordBotSetDefaultChannelSchema = z.object({
    channelId: z.string().min(1),
});
export type DiscordBotSetDefaultChannelDto = z.infer<typeof DiscordBotSetDefaultChannelSchema>;

/** ROK-547: Body for PUT /admin/settings/discord-bot/voice-channel */
export const DiscordBotSetVoiceChannelSchema = z.object({
    channelId: z.string().min(1),
});
export type DiscordBotSetVoiceChannelDto = z.infer<typeof DiscordBotSetVoiceChannelSchema>;

/** ROK-547: Body for PUT /admin/settings/discord-bot/ad-hoc */
export const DiscordBotSetAdHocStatusSchema = z.object({
    enabled: z.boolean(),
});
export type DiscordBotSetAdHocStatusDto = z.infer<typeof DiscordBotSetAdHocStatusSchema>;

/** ROK-1064: A single Discord text channel surfaced by GET /discord/channels. */
export const DiscordChannelSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
});
export type DiscordChannelSummaryDto = z.infer<typeof DiscordChannelSummarySchema>;

/** ROK-1064: Response body for GET /discord/channels. */
export const DiscordChannelListResponseSchema = z.object({
    data: z.array(DiscordChannelSummarySchema),
});
export type DiscordChannelListResponseDto = z.infer<typeof DiscordChannelListResponseSchema>;

/**
 * ROK-1352: Global ephemeral-voice configuration.
 * GET /admin/settings/discord-bot/ephemeral-voice returns this shape.
 * Buffer/idle default to 30 minutes; both must be non-negative.
 */
export const EphemeralVoiceConfigSchema = z.object({
    enabled: z.boolean(),
    /** ROK-1352: when true, EVERY managed event gets an ephemeral channel and
     *  voice links never resolve to a pre-existing/static channel. Requires
     *  `enabled`. Default off. */
    forced: z.boolean().default(false),
    categoryId: z.string().nullable(),
    createBufferMinutes: z.number().int().min(0).default(30),
    idleMinutes: z.number().int().min(0).default(30),
});
export type EphemeralVoiceConfig = z.infer<typeof EphemeralVoiceConfigSchema>;

/** ROK-1352: Body for PUT /admin/settings/discord-bot/ephemeral-voice (partial). */
export const SetEphemeralVoiceConfigSchema = EphemeralVoiceConfigSchema.partial();
export type SetEphemeralVoiceConfigDto = z.infer<typeof SetEphemeralVoiceConfigSchema>;

/** ROK-1352: A Discord category channel surfaced by GET .../ephemeral-voice/categories. */
export const DiscordCategorySummarySchema = z.object({
    id: z.string(),
    name: z.string(),
});
export type DiscordCategorySummaryDto = z.infer<typeof DiscordCategorySummarySchema>;

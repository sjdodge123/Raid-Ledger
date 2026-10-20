import { z } from 'zod';
import { ThreadMessageSchema } from './discord-threads.schema.js';

/**
 * ROK-1788 — the guild page's read-only Discord channel mirror (S4).
 *
 * Unlike the ROK-1483 thread mirror, NOTHING here is stored: the API reads the
 * latest messages of the bound channel live from Discord, caches the result
 * in-process for 60s, and never writes message content to Postgres or Redis.
 * Only the binding (which channel) is persisted, on `guild_profiles`.
 */

/** A Discord snowflake as a request field: 17-20 digits, nothing else. */
const SnowflakeInputSchema = z
    .string()
    .regex(/^\d{17,20}$/, 'channelId must be a Discord channel id');

/** `public` = `@everyone` can view the channel; `private` = it cannot (D7). */
export const GuildDiscordChannelVisibilitySchema = z.enum(['public', 'private']);
export type GuildDiscordChannelVisibility = z.infer<
    typeof GuildDiscordChannelVisibilitySchema
>;

/** One channel the bot can read, as offered by the picker (D8). */
export const GuildDiscordChannelOptionSchema = z.object({
    id: z.string(),
    name: z.string(),
    visibility: GuildDiscordChannelVisibilitySchema,
});
export type GuildDiscordChannelOptionDto = z.infer<
    typeof GuildDiscordChannelOptionSchema
>;

/**
 * The bot's Discord server name, for "Latest from the <server> Discord" copy.
 * Optional (additive): absent when the bot is down or the name is unknown, and
 * the web falls back to "the community Discord".
 */
const ServerNameSchema = z.string().optional();

/** Response of `GET .../discord/channels`; `connected:false` = bot down. */
export const GuildDiscordChannelListSchema = z.object({
    connected: z.boolean(),
    channels: z.array(GuildDiscordChannelOptionSchema),
    serverName: ServerNameSchema,
});
export type GuildDiscordChannelListDto = z.infer<
    typeof GuildDiscordChannelListSchema
>;

/** Body of `PUT .../discord/channel`. `privateAck` is required for a private channel. */
export const SetGuildDiscordChannelSchema = z
    .object({
        channelId: SnowflakeInputSchema,
        privateAck: z.boolean().optional(),
    })
    .strict();
export type SetGuildDiscordChannelDto = z.infer<
    typeof SetGuildDiscordChannelSchema
>;

/** The first embed of a message, reduced to its text (operator ruling Q4). */
export const GuildDiscordEmbedSchema = z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
});
export type GuildDiscordEmbedDto = z.infer<typeof GuildDiscordEmbedSchema>;

/**
 * One mirrored message: the thread-mirror DTO plus the optional embed.
 * `embed` is null when the message has no embed with a title or description.
 */
export const GuildDiscordMessageSchema = ThreadMessageSchema.extend({
    embed: GuildDiscordEmbedSchema.nullable(),
});
export type GuildDiscordMessageDto = z.infer<typeof GuildDiscordMessageSchema>;

/** The bound channel as the card shows it; `url` is built server-side (D12). */
export const GuildDiscordChannelSchema = GuildDiscordChannelOptionSchema.extend({
    url: z.string(),
    serverName: ServerNameSchema,
});
export type GuildDiscordChannelDto = z.infer<typeof GuildDiscordChannelSchema>;

/**
 * Response of `GET .../discord` — every state renders inside the card (D9),
 * never as an error page.
 *
 * - `unset`: no channel bound.
 * - `disconnected`: the bot is down or Discord failed transiently; the
 *   channel name cannot be resolved, so only the bound id (if any) is sent.
 * - `no-access`: the bot lost ViewChannel/ReadMessageHistory (or 50001/50013).
 * - `gone`: the channel no longer exists, or is no longer a text channel.
 * - `ok`: the latest messages, oldest first.
 */
/** ROK-1428: who set the hub's channel — the lifecycle (`auto`) or a Leader (`manual`). */
export const GuildDiscordChannelSourceSchema = z.enum(['auto', 'manual']);
export type GuildDiscordChannelSource = z.infer<typeof GuildDiscordChannelSourceSchema>;

export const GuildDiscordManagedForSchema = z.object({
    gameId: z.number().int(),
    gameName: z.string(),
});
export type GuildDiscordManagedForDto = z.infer<typeof GuildDiscordManagedForSchema>;

export const GuildDiscordMirrorSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('unset') }),
    z.object({
        state: z.literal('disconnected'),
        channelId: z.string().nullable(),
    }),
    z.object({
        state: z.literal('no-access'),
        channelId: z.string(),
        channelName: z.string().nullable(),
    }),
    z.object({
        state: z.literal('gone'),
        channelId: z.string(),
        channelName: z.string().nullable(),
    }),
    z.object({
        state: z.literal('ok'),
        channel: GuildDiscordChannelSchema,
        messages: z.array(GuildDiscordMessageSchema),
        /** ISO timestamp of the Discord read the (possibly cached) result came from. */
        fetchedAt: z.string(),
        /**
         * ROK-1428: how the channel got here — `auto` when the channel
         * lifecycle linked the game's managed channel, `manual` when a
         * Leader picked it. Absent/null on rows written before the column.
         */
        channelSource: GuildDiscordChannelSourceSchema.nullable().optional(),
        /** Set when the bound channel is a lifecycle-managed game channel. */
        managedFor: GuildDiscordManagedForSchema.nullable().optional(),
    }),
]);
export type GuildDiscordMirrorDto = z.infer<typeof GuildDiscordMirrorSchema>;

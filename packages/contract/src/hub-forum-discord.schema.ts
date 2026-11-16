import { z } from 'zod';

/**
 * Hub Forum ↔ Discord forum sync (ROK-2208). A Leader binds the hub Forum to
 * a Discord forum channel: a new bot-made one, or an existing one that other
 * hubs may share (each hub gets its own forum tag). Binding needs an explicit
 * acknowledgement that everyone who can see the channel can read and post.
 */

const isoDate = z.iso.datetime({ offset: true });

/** A Discord snowflake as a request field: 17-20 digits, nothing else. */
const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, 'channelId must be a Discord channel id');

/** Name of the forum channel the bot creates (operator ruling, Q10 Q2). */
export const HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME = 'hub-forums';
/** Discord's tag cap per forum channel; a full forum cannot take a new hub. */
export const HUB_FORUM_DISCORD_TAG_LIMIT = 20;
/** Discord's message cap; longer RL bodies are truncated with a link. */
export const HUB_FORUM_DISCORD_BODY_MAX = 2000;

/** `create` = the bot makes a forum; `existing` = bind a forum the bot sees. */
export const HubForumDiscordModeSchema = z.enum(['create', 'existing']);
export type HubForumDiscordMode = z.infer<typeof HubForumDiscordModeSchema>;

/** `PUT /guilds/:id/forum/discord` — bind (or rebind) the hub's forum. */
export const PutHubForumDiscordSchema = z
  .object({
    mode: HubForumDiscordModeSchema,
    /** Required for `existing`; ignored for `create`. */
    channelId: snowflake.optional(),
    /** The visibility acknowledgement; anything but `true` is a 400. */
    ack: z.literal(true),
  })
  .strict()
  .refine((v) => v.mode !== 'existing' || v.channelId !== undefined, {
    message: 'channelId is required to bind an existing forum',
    path: ['channelId'],
  });
export type PutHubForumDiscordInput = z.infer<typeof PutHubForumDiscordSchema>;

/** Why sync is degraded; `ok` when the bot can do everything it needs. */
export const HubForumDiscordHealthSchema = z.enum([
  'ok',
  'missing-perms',
  'channel-missing',
  'bot-offline',
]);
export type HubForumDiscordHealth = z.infer<typeof HubForumDiscordHealthSchema>;

/** The hub's live binding. */
export const HubForumDiscordBindingSchema = z
  .object({
    channelId: z.string(),
    channelName: z.string(),
    /** The bot created this channel. */
    managed: z.boolean(),
    /** Another hub is bound to the same channel. */
    shared: z.boolean(),
    /** How many OTHER hubs share the channel. */
    sharedWith: z.number().int().nonnegative(),
    /** This hub's forum tag; null while the forum is unshared. */
    tagName: z.string().nullable(),
    boundAt: isoDate,
    health: HubForumDiscordHealthSchema,
    /** Discord permission names the bot lacks in the channel. */
    missingPermissions: z.array(z.string()),
  })
  .strict();
export type HubForumDiscordBinding = z.infer<typeof HubForumDiscordBindingSchema>;

/** `GET /guilds/:id/forum/discord` — null binding while unlinked. */
export const HubForumDiscordStatusSchema = z
  .object({ binding: HubForumDiscordBindingSchema.nullable() })
  .strict();
export type HubForumDiscordStatus = z.infer<typeof HubForumDiscordStatusSchema>;

/** One forum channel the picker offers for `existing`. */
export const HubForumDiscordChannelOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Hubs already bound to this channel. */
    sharedWith: z.number().int().nonnegative(),
    /** Tags the channel can still take (0 = full, option disabled). */
    tagsFree: z.number().int().nonnegative(),
  })
  .strict();
export type HubForumDiscordChannelOption = z.infer<
  typeof HubForumDiscordChannelOptionSchema
>;

/** `GET /guilds/:id/forum/discord/channels`. */
export const HubForumDiscordChannelOptionsSchema = z
  .object({ channels: z.array(HubForumDiscordChannelOptionSchema) })
  .strict();
export type HubForumDiscordChannelOptions = z.infer<
  typeof HubForumDiscordChannelOptionsSchema
>;

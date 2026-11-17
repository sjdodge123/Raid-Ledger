import { z } from "zod";

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
  .regex(/^\d{17,20}$/, "channelId must be a Discord channel id");

/** Name of the forum channel the bot creates (operator ruling, Q10 Q2). */
export const HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME = "hub-forums";
/** Discord's tag cap per forum channel; a full forum cannot take a new hub. */
export const HUB_FORUM_DISCORD_TAG_LIMIT = 20;
/** Discord's message cap; longer RL bodies are truncated with a link. */
export const HUB_FORUM_DISCORD_BODY_MAX = 2000;

/** `create` = the bot makes a forum; `existing` = bind a forum the bot sees. */
export const HubForumDiscordModeSchema = z.enum(["create", "existing"]);
export type HubForumDiscordMode = z.infer<typeof HubForumDiscordModeSchema>;

/**
 * What `create` makes (Q10 option c): `own` (the default) = a new forum for
 * this hub alone; `shared` = join the bot's shared `#hub-forums`, created the
 * first time a hub picks it and reused after (never a second one).
 */
export const HubForumDiscordTargetSchema = z.enum(["own", "shared"]);
export type HubForumDiscordTarget = z.infer<typeof HubForumDiscordTargetSchema>;

/** `PUT /guilds/:id/forum-discord` — bind (or rebind) the hub's forum. */
export const PutHubForumDiscordSchema = z
  .object({
    mode: HubForumDiscordModeSchema,
    /** Required for `existing`; ignored for `create`. */
    channelId: snowflake.optional(),
    /** `create` only; omitted = `own`. */
    target: HubForumDiscordTargetSchema.optional(),
    /** `create` + `own` only: the channel name; default = the hub's name. */
    name: z.string().trim().min(1).max(100).optional(),
    /** The visibility acknowledgement; anything but `true` is a 400. */
    ack: z.literal(true),
  })
  .strict()
  .refine((v) => v.mode !== "existing" || v.channelId !== undefined, {
    message: "channelId is required to bind an existing forum",
    path: ["channelId"],
  });
export type PutHubForumDiscordInput = z.infer<typeof PutHubForumDiscordSchema>;

/** Why sync is degraded; `ok` when the bot can do everything it needs. */
export const HubForumDiscordHealthSchema = z.enum([
  "ok",
  "missing-perms",
  "channel-missing",
  "bot-offline",
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
export type HubForumDiscordBinding = z.infer<
  typeof HubForumDiscordBindingSchema
>;

/** `GET /guilds/:id/forum-discord` — null binding while unlinked. */
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
    /** Discord permission names the bot lacks in this channel. */
    missingPermissions: z.array(z.string()).optional(),
  })
  .strict();
export type HubForumDiscordChannelOption = z.infer<
  typeof HubForumDiscordChannelOptionSchema
>;

/** `GET /guilds/:id/forum-discord/channels`. */
export const HubForumDiscordChannelOptionsSchema = z
  .object({ channels: z.array(HubForumDiscordChannelOptionSchema) })
  .strict();
export type HubForumDiscordChannelOptions = z.infer<
  typeof HubForumDiscordChannelOptionsSchema
>;

/** The shared `#hub-forums` as the form's "Shared server forum" option. */
export const HubForumDiscordSharedOptionSchema = z
  .object({
    /** null = it does not exist yet; the bot creates it on bind. */
    channelId: z.string().nullable(),
    name: z.string(),
    /** Hubs already bound to it. */
    sharedWith: z.number().int().nonnegative(),
    /** Tags on the forum now ("3 of 20 tags used"), moderators' included. */
    tagsUsed: z.number().int().nonnegative(),
    /** 0 = full: the option is disabled and the hub's own forum preselected. */
    tagsFree: z.number().int().nonnegative(),
    /** The tag this hub would get; null while it would be the only hub. */
    tagName: z.string().nullable(),
    /** Permissions the bot lacks to create (or tag) the shared forum. */
    missingPermissions: z.array(z.string()),
  })
  .strict();
export type HubForumDiscordSharedOption = z.infer<
  typeof HubForumDiscordSharedOptionSchema
>;

/**
 * `GET /guilds/:id/forum-discord/preflight` — what the unbound form shows
 * before "Turn on sync": never a 503, `botOnline: false` instead.
 */
export const HubForumDiscordPreflightSchema = z
  .object({
    botOnline: z.boolean(),
    /** Server-wide permissions the bot lacks to create a forum. */
    missingToCreate: z.array(z.string()),
    /** Default name of the hub's own new forum (from the hub name). */
    suggestedName: z.string(),
    /** null while the bot is offline. */
    shared: HubForumDiscordSharedOptionSchema.nullable(),
  })
  .strict();
export type HubForumDiscordPreflight = z.infer<
  typeof HubForumDiscordPreflightSchema
>;

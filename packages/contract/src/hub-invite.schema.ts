import { z } from 'zod';

/**
 * ROK-1893 P1 — community-hub invite links + auto-membership.
 * Rulings (spec §8a/§8d): any live member creates links (7-day default
 * expiry, unlimited uses, 5 live links per member); the maker, hub
 * Leaders/Officers and staff revoke; the redeemer must already be in the
 * Discord server (the preview offers a bot-made server invite when it can);
 * links do not work on hidden or proposed hubs. Auto-membership is per hub:
 * `suggest` asks the person who signed up, `auto` joins them and tells them.
 * Additive; every schema here is a new endpoint's payload or an optional field.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

/** Live (not revoked, not expired) links one member may hold per hub. */
export const HUB_INVITES_PER_MEMBER = 5;
export const HUB_INVITE_DEFAULT_EXPIRY_HOURS = 168;
export const HUB_INVITE_MAX_EXPIRY_HOURS = 720;

export const HubInviteSchema = z
  .object({
    id,
    /** The share token; sent only to the maker, hub Leaders/Officers and staff. */
    token: z.string().nullable(),
    /** Absolute link to the `/h/:token` landing page; null when `token` is. */
    url: z.string().nullable(),
    createdBy: z.object({ id, displayName: z.string() }).strict().nullable(),
    createdAt: isoDate,
    expiresAt: isoDate.nullable(),
    maxUses: z.number().int().positive().nullable(),
    useCount: z.number().int().nonnegative(),
    revokedAt: isoDate.nullable(),
    /** The viewer may revoke it (maker, Leader/Officer or staff). */
    canRevoke: z.boolean(),
  })
  .strict();
export type HubInvite = z.infer<typeof HubInviteSchema>;

export const HubInviteListSchema = z
  .object({
    items: z.array(HubInviteSchema),
    /** The viewer's live links on this hub, against `HUB_INVITES_PER_MEMBER`. */
    liveByViewer: z.number().int().nonnegative(),
    perMemberCap: z.number().int().positive(),
  })
  .strict();
export type HubInviteList = z.infer<typeof HubInviteListSchema>;

export const CreateHubInviteSchema = z
  .object({
    /** Omitted ⇒ 7 days; null ⇒ never expires. */
    expiresInHours: z.number().int().min(1).max(HUB_INVITE_MAX_EXPIRY_HOURS).nullable().optional(),
    /** Omitted or null ⇒ unlimited. */
    maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type CreateHubInviteDto = z.infer<typeof CreateHubInviteSchema>;

export const HubInviteStateSchema = z.enum(['ok', 'expired', 'revoked', 'exhausted', 'hub-unavailable']);
export type HubInviteState = z.infer<typeof HubInviteStateSchema>;

/** Public preview behind `GET /hubs/invites/:token` (no auth). */
export const HubInvitePreviewSchema = z
  .object({
    state: HubInviteStateSchema,
    /** Null when `state` is `hub-unavailable` (nothing about the hub leaks). */
    hub: z
      .object({
        id,
        name: z.string(),
        gameName: z.string().nullable(),
        gameCoverUrl: z.string().nullable(),
        memberCount: z.number().int().nonnegative(),
        blurb: z.string().nullable(),
      })
      .strict()
      .nullable(),
    /** Signed-in viewer is already a live member; false when signed out. */
    alreadyMember: z.boolean(),
    /** Signed-in viewer is in the hub's Discord server; null when signed out. */
    inDiscordServer: z.boolean().nullable(),
    /** A bot-made Discord server invite for viewers not in the server; null when the bot can't make one. */
    discordServerInviteUrl: z.string().nullable(),
  })
  .strict();
export type HubInvitePreview = z.infer<typeof HubInvitePreviewSchema>;

export const HubInviteJoinResponseSchema = z
  .object({
    hubId: id,
    /** False when the viewer was already a member (re-redeeming is a no-op). */
    joined: z.boolean(),
    memberCount: z.number().int().nonnegative(),
  })
  .strict();
export type HubInviteJoinResponse = z.infer<typeof HubInviteJoinResponseSchema>;

export const HubAutoMembershipModeSchema = z.enum(['off', 'suggest', 'auto']);
export type HubAutoMembershipMode = z.infer<typeof HubAutoMembershipModeSchema>;

export const UpdateHubAutoMembershipSchema = z.object({ mode: HubAutoMembershipModeSchema }).strict();
export type UpdateHubAutoMembershipDto = z.infer<typeof UpdateHubAutoMembershipSchema>;

/** How a member joined; null on rows that predate ROK-1893. */
export const HubJoinSourceSchema = z.enum(['manual', 'invite', 'auto', 'prompt']);
export type HubJoinSource = z.infer<typeof HubJoinSourceSchema>;

/**
 * A hub join prompt for the signed-in user (ruling §8d): `suggest` → "Join
 * <hub>?" (Join / Not now); `auto-joined` → "You joined <hub> — leave anytime".
 */
export const HubJoinPromptSchema = z
  .object({
    id,
    kind: z.enum(['suggest', 'auto-joined']),
    hubId: id,
    hubName: z.string(),
    /** What triggered it: an event signup (P1) or a hub poll vote (P3). */
    source: z.enum(['signup', 'vote']),
    /** The event id (signup) or lineup id (vote). */
    sourceRef: id.nullable(),
    createdAt: isoDate,
  })
  .strict();
export type HubJoinPrompt = z.infer<typeof HubJoinPromptSchema>;

export const HubJoinPromptListSchema = z.object({ items: z.array(HubJoinPromptSchema) }).strict();
export type HubJoinPromptList = z.infer<typeof HubJoinPromptListSchema>;

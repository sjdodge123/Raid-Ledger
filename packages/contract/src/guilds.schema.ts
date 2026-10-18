import { z } from 'zod';
import { CharacterRoleSchema } from './characters.schema.js';
import { GameServerStateSchema } from './game-servers.schema.js';

/**
 * ROK-1785 (S1 of ROK-1781): guild page `/guilds/:id` — read shapes and the
 * editor-delegation mutations. WoW-plugin owned (`/plugins/wow/guilds`).
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

/**
 * ROK-1830 — what kind of group a hub is. Every row today is a WoW guild
 * (`guilds.kind` defaults to `wow_guild`); `game_server` arrives with ROK-1831.
 */
export const GUILD_KINDS = ['wow_guild', 'game_server'] as const;
export const GuildKindSchema = z.enum(GUILD_KINDS);
export type GuildKind = z.infer<typeof GuildKindSchema>;

/**
 * ROK-1830 D5-A — the hub permission ladder, highest first. `canEdit` is
 * leader|officer and `canManageEditors` is leader; both stay on the viewer
 * object so existing clients keep working.
 */
export const LADDER_ROLES = ['leader', 'officer', 'member', 'visitor'] as const;
export const LadderRoleSchema = z.enum(LADDER_ROLES);
export type LadderRole = z.infer<typeof LadderRoleSchema>;

/** What the viewer may do on one guild (computed live per request). */
export const GuildViewerAccessSchema = z
  .object({
    role: LadderRoleSchema,
    canEdit: z.boolean(),
    canManageEditors: z.boolean(),
  })
  .strict();
export type GuildViewerAccess = z.infer<typeof GuildViewerAccessSchema>;

/** One guild in a list (nav menu, Players card, game page, character badge). */
export const GuildSummarySchema = z
  .object({
    id,
    gameId: id,
    kind: GuildKindSchema,
    name: z.string(),
    region: z.string(),
    realmSlug: z.string().nullable(),
    /** The realm the addon reported (`guilds.raw_realm`) — display only; WoW: Forever rows have no `realmSlug`. */
    realmName: z.string().nullable(),
    faction: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    lastSnapshotAt: isoDate.nullable(),
    /** ROK-1831 — `guilds.hidden_at` is set; sent to staff only. */
    hidden: z.boolean().optional(),
  })
  .strict();
export type GuildSummary = z.infer<typeof GuildSummarySchema>;

/** ROK-1831 — the game-server columns of one hub member (WoW rows omit it). */
export const GuildMemberServerSchema = z
  .object({
    lastSeenAt: isoDate.nullable(),
    onlineNow: z.boolean(),
    /** Last in-game character name presence saw on this server. */
    characterName: z.string().nullable(),
    /** The last way they qualified: seen on the server, or pressed Join. */
    source: z.enum(['presence', 'manual']),
    /** First sighting or Join (`hub_server_members.first_seen_at`); optional so older fixtures parse. */
    firstSeenAt: isoDate.nullable().optional(),
  })
  .strict();
export type GuildMemberServer = z.infer<typeof GuildMemberServerSchema>;

/** One roster row. Unlinked rows have `characterId: null` and no role. */
export const GuildMemberRowSchema = z
  .object({
    memberId: id,
    name: z.string(),
    class: z.string().nullable(),
    level: z.number().int().nullable(),
    rankIndex: z.number().int().nullable(),
    rankName: z.string().nullable(),
    /** Linked character's `roleOverride ?? role`. */
    effectiveRole: CharacterRoleSchema.nullable(),
    /** `characters.id` is a UUID; null when no RL character links (D9). */
    characterId: z.string().uuid().nullable(),
    isMain: z.boolean(),
    server: GuildMemberServerSchema.optional(),
  })
  .strict();
export type GuildMemberRow = z.infer<typeof GuildMemberRowSchema>;

/** Roster group for one rank, ordered by `rankIndex` ascending (0 = GM). */
export const GuildRankGroupSchema = z
  .object({
    rankIndex: z.number().int().nullable(),
    rankName: z.string().nullable(),
    members: z.array(GuildMemberRowSchema),
  })
  .strict();
export type GuildRankGroup = z.infer<typeof GuildRankGroupSchema>;

/** `GET /plugins/wow/guilds/:id` — hero fields + roster grouped by rank. */
/**
 * Roster role mix: ONE count per linked RL user (their main in this guild,
 * else their highest-rank character). Unlinked members are not counted;
 * a linked character with no role counts as `unknown`.
 */
export const GuildRoleCountsSchema = z
  .object({
    tank: z.number().int().nonnegative(),
    healer: z.number().int().nonnegative(),
    dps: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  })
  .strict();
export type GuildRoleCounts = z.infer<typeof GuildRoleCountsSchema>;

/** ROK-1831 — the game-server hero block of a `game_server` hub page. */
/** ROK-1831 — one row of the server hub's "Recent arrivals" widget (first-seen only). */
export const GuildServerArrivalSchema = z
  .object({
    memberId: id,
    name: z.string(),
    characterName: z.string().nullable(),
    firstSeenAt: isoDate,
  })
  .strict();
export type GuildServerArrival = z.infer<typeof GuildServerArrivalSchema>;

export const GuildPageServerSchema = z
  .object({
    pelicanServerId: id,
    gameSlug: z.string(),
    gameIconUrl: z.string().nullable(),
    state: GameServerStateSchema,
    /** The viewer pressed Join and has not left. */
    viewerJoined: z.boolean(),
    /** Newest five members by first sighting; optional so older fixtures parse. */
    recentArrivals: z.array(GuildServerArrivalSchema).max(5).optional(),
  })
  .strict();
export type GuildPageServer = z.infer<typeof GuildPageServerSchema>;

export const GuildPageSchema = z
  .object({
    guild: GuildSummarySchema,
    /** Display name of whoever imported the latest snapshot, if known. */
    importedBy: z.string().nullable(),
    viewer: GuildViewerAccessSchema,
    ranks: z.array(GuildRankGroupSchema),
    roleCounts: GuildRoleCountsSchema,
    server: GuildPageServerSchema.optional(),
  })
  .strict();
export type GuildPage = z.infer<typeof GuildPageSchema>;

/** One of the viewer's guilds: summary + their best (lowest) rank + edit right. */
export const MyGuildSchema = GuildSummarySchema.extend({
  rankIndex: z.number().int().nullable(),
  rankName: z.string().nullable(),
  canEdit: z.boolean(),
  /** ROK-1786 — first line of the GM post (≤120 chars), null when unset. */
  gmPostHeadline: z.string().nullable(),
  /** ROK-1831 D6 — the hub game's icon (`games.cover_url`) for the nav menu; null/absent = generic crest. */
  gameIconUrl: z.string().nullable().optional(),
}).strict();
export type MyGuild = z.infer<typeof MyGuildSchema>;

/** `GET /plugins/wow/guilds/mine` — guilds the viewer is a member of. */
export const MyGuildsSchema = z
  .object({ guilds: z.array(MyGuildSchema) })
  .strict();
export type MyGuilds = z.infer<typeof MyGuildsSchema>;

/** `GET /plugins/wow/guilds?gameId=` — guilds of a game the viewer can open. */
export const GuildListQuerySchema = z
  .object({ gameId: z.coerce.number().int().positive() })
  .strict();
export type GuildListQuery = z.infer<typeof GuildListQuerySchema>;

/** `GET /plugins/wow/guilds/by-character/:characterId` — the badge's guild. */
export const CharacterGuildSchema = z
  .object({
    data: z
      .object({
        guild: GuildSummarySchema,
        rankName: z.string().nullable(),
        /** The signed-in viewer may open the guild page (member or staff). */
        viewerCanOpen: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type CharacterGuild = z.infer<typeof CharacterGuildSchema>;

export const GUILD_EDITOR_KINDS = ['rank', 'member'] as const;
export const GuildEditorKindSchema = z.enum(GUILD_EDITOR_KINDS);
export type GuildEditorKind = z.infer<typeof GuildEditorKindSchema>;

/** One delegation grant: a whole rank, or one guild member row. */
export const GuildEditorSchema = z
  .object({
    id,
    guildId: id,
    kind: GuildEditorKindSchema,
    rankIndex: z.number().int().nonnegative().nullable(),
    rankName: z.string().nullable(),
    guildMemberId: id.nullable(),
    memberName: z.string().nullable(),
    grantedBy: z.string().nullable(),
    createdAt: isoDate,
  })
  .strict();
export type GuildEditor = z.infer<typeof GuildEditorSchema>;

export const GuildEditorListSchema = z
  .object({ editors: z.array(GuildEditorSchema) })
  .strict();
export type GuildEditorList = z.infer<typeof GuildEditorListSchema>;

/** `POST /plugins/wow/guilds/:id/editors` — rank 0 is the GM, never granted. */
export const CreateGuildEditorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('rank'),
      rankIndex: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('member'), guildMemberId: id }).strict(),
]);
export type CreateGuildEditorInput = z.infer<typeof CreateGuildEditorSchema>;

/** `DELETE /plugins/wow/guilds/:id/editors/:editorId` path params. */
export const DeleteGuildEditorParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    editorId: z.coerce.number().int().positive(),
  })
  .strict();
export type DeleteGuildEditorParams = z.infer<
  typeof DeleteGuildEditorParamsSchema
>;

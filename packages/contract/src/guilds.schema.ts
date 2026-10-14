import { z } from 'zod';
import { CharacterRoleSchema } from './characters.schema.js';

/**
 * ROK-1785 (S1 of ROK-1781): guild page `/guilds/:id` — read shapes and the
 * editor-delegation mutations. WoW-plugin owned (`/plugins/wow/guilds`).
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

/** What the viewer may do on one guild (computed live per request). */
export const GuildViewerAccessSchema = z
  .object({
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
    name: z.string(),
    region: z.string(),
    realmSlug: z.string().nullable(),
    faction: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    lastSnapshotAt: isoDate.nullable(),
  })
  .strict();
export type GuildSummary = z.infer<typeof GuildSummarySchema>;

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
export const GuildPageSchema = z
  .object({
    guild: GuildSummarySchema,
    /** Display name of whoever imported the latest snapshot, if known. */
    importedBy: z.string().nullable(),
    viewer: GuildViewerAccessSchema,
    ranks: z.array(GuildRankGroupSchema),
  })
  .strict();
export type GuildPage = z.infer<typeof GuildPageSchema>;

/** `GET /plugins/wow/guilds/mine` — guilds the viewer is a member of. */
export const MyGuildsSchema = z
  .object({ guilds: z.array(GuildSummarySchema) })
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
      .object({ guild: GuildSummarySchema, rankName: z.string().nullable() })
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

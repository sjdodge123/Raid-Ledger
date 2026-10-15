import { z } from 'zod';

/**
 * ROK-1786 (S2 of ROK-1781): guild page content — the GM post, rules, links
 * and recommended addons. WoW-plugin owned (`/plugins/wow/guilds/:id/...`).
 * Sibling of `guilds.schema.ts` (kept apart for the 300-line limit).
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

export const GUILD_GM_POST_MAX = 4000;
export const GUILD_RULES_MAX_SECTIONS = 20;
export const GUILD_RULE_TITLE_MAX = 80;
export const GUILD_RULE_BODY_MAX = 2000;
export const GUILD_LINK_GROUPS_MAX = 10;
export const GUILD_LINKS_PER_GROUP_MAX = 20;
export const GUILD_LINK_LABEL_MAX = 80;
export const GUILD_LINK_NOTE_MAX = 140;
export const GUILD_URL_MAX = 500;
export const GUILD_ADDONS_MAX = 50;
export const GUILD_ADDON_NAME_MAX = 120;
export const GUILD_ADDON_NOTE_MAX = 500;
export const GUILD_PINNED_ADDONS_MAX = 20;

/** An absolute http(s) URL — no `javascript:`, `data:` or relative links. */
export const GuildHttpUrlSchema = z
  .url({ protocol: /^https?$/, normalize: false })
  .max(GUILD_URL_MAX);

/** One rules section (ordered by array position). */
export const GuildRuleSectionSchema = z
  .object({
    title: z.string().trim().min(1).max(GUILD_RULE_TITLE_MAX),
    body: z.string().trim().min(1).max(GUILD_RULE_BODY_MAX),
  })
  .strict();
export type GuildRuleSection = z.infer<typeof GuildRuleSectionSchema>;

export const GuildLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(GUILD_LINK_LABEL_MAX),
    url: GuildHttpUrlSchema,
    note: z.string().trim().max(GUILD_LINK_NOTE_MAX).optional(),
  })
  .strict();
export type GuildLink = z.infer<typeof GuildLinkSchema>;

/** A titled group of links ("Guides", "Logs", ...), ordered by position. */
export const GuildLinkGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(GUILD_LINK_LABEL_MAX),
    links: z.array(GuildLinkSchema).min(1).max(GUILD_LINKS_PER_GROUP_MAX),
  })
  .strict();
export type GuildLinkGroup = z.infer<typeof GuildLinkGroupSchema>;

export const GuildRulesSchema = z
  .array(GuildRuleSectionSchema)
  .max(GUILD_RULES_MAX_SECTIONS);
export const GuildLinkGroupsSchema = z
  .array(GuildLinkGroupSchema)
  .max(GUILD_LINK_GROUPS_MAX);

export const GuildGmPostSchema = z
  .object({
    body: z.string().max(GUILD_GM_POST_MAX),
    updatedAt: isoDate,
    /** Display name of the last editor; null once that user is wiped. */
    updatedBy: z.string().nullable(),
  })
  .strict();
export type GuildGmPost = z.infer<typeof GuildGmPostSchema>;

/** `GET /plugins/wow/guilds/:id/profile` — empty lists when never edited. */
export const GuildProfileSchema = z
  .object({
    guildId: id,
    gmPost: GuildGmPostSchema.nullable(),
    rules: GuildRulesSchema,
    links: GuildLinkGroupsSchema,
  })
  .strict();
export type GuildProfile = z.infer<typeof GuildProfileSchema>;

/**
 * `PATCH /plugins/wow/guilds/:id/profile` — only the keys sent change.
 * `gmPost: null` (or blank) clears the post; `[]` clears rules / links.
 */
export const UpdateGuildProfileSchema = z
  .object({
    gmPost: z.string().trim().max(GUILD_GM_POST_MAX).nullable().optional(),
    rules: GuildRulesSchema.optional(),
    links: GuildLinkGroupsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Send at least one of gmPost, rules or links',
  });
export type UpdateGuildProfileInput = z.infer<typeof UpdateGuildProfileSchema>;

export const GUILD_ADDON_SOURCES = [
  'curseforge',
  'wago',
  'github',
  'url',
] as const;
export const GuildAddonSourceSchema = z.enum(GUILD_ADDON_SOURCES);
export type GuildAddonSource = z.infer<typeof GuildAddonSourceSchema>;

export const GUILD_ADDON_REQUIREMENTS = ['required', 'optional'] as const;
export const GuildAddonRequirementSchema = z.enum(GUILD_ADDON_REQUIREMENTS);
export type GuildAddonRequirement = z.infer<
  typeof GuildAddonRequirementSchema
>;

/** Game flavor an addon targets; `null` on an addon means every flavor. */
export const GUILD_ADDON_FLAVORS = ['retail', 'classic', 'forever'] as const;
export const GuildAddonFlavorSchema = z.enum(GUILD_ADDON_FLAVORS);
export type GuildAddonFlavor = z.infer<typeof GuildAddonFlavorSchema>;

const addonName = z.string().trim().min(1).max(GUILD_ADDON_NAME_MAX);
const addonNote = z.string().trim().max(GUILD_ADDON_NOTE_MAX).nullable();

/** One guild-recommended addon (ordered by `sortOrder`). */
export const GuildAddonSchema = z
  .object({
    id,
    guildId: id,
    source: GuildAddonSourceSchema,
    /** Slug (`owner/repo` for GitHub) or, for `url`, the normalised URL. */
    slugOrUrl: z.string(),
    /** Canonical link-out built from source + slug. */
    url: z.string(),
    displayName: z.string(),
    note: z.string().nullable(),
    requirement: GuildAddonRequirementSchema,
    flavor: GuildAddonFlavorSchema.nullable(),
    sortOrder: z.number().int(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type GuildAddon = z.infer<typeof GuildAddonSchema>;

/** `POST .../addons` — the link is parsed server-side into source + slug. */
export const CreateGuildAddonSchema = z
  .object({
    url: GuildHttpUrlSchema,
    /** Defaults to a title-cased name derived from the link. */
    displayName: addonName.optional(),
    note: addonNote.optional(),
    requirement: GuildAddonRequirementSchema.default('optional'),
    flavor: GuildAddonFlavorSchema.nullable().optional(),
  })
  .strict();
export type CreateGuildAddonInput = z.infer<typeof CreateGuildAddonSchema>;

/** `PATCH .../addons/:addonId` — only the keys sent change. */
export const UpdateGuildAddonSchema = z
  .object({
    url: GuildHttpUrlSchema.optional(),
    displayName: addonName.optional(),
    note: addonNote.optional(),
    requirement: GuildAddonRequirementSchema.optional(),
    flavor: GuildAddonFlavorSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Send at least one field to change',
  });
export type UpdateGuildAddonInput = z.infer<typeof UpdateGuildAddonSchema>;

/** `PUT .../addons/order` — every addon id of the guild, in the new order. */
export const ReorderGuildAddonsSchema = z
  .object({ ids: z.array(id).min(1).max(GUILD_ADDONS_MAX) })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, {
    message: 'Duplicate addon id',
    path: ['ids'],
  });
export type ReorderGuildAddonsInput = z.infer<typeof ReorderGuildAddonsSchema>;

/** A community-wide pinned addon (setting `guild_pinned_addons`). */
export const PinnedAddonSchema = z
  .object({
    name: addonName,
    url: GuildHttpUrlSchema,
    note: addonNote,
    requirement: GuildAddonRequirementSchema,
    /** Empty = every flavor. */
    flavors: z.array(GuildAddonFlavorSchema),
  })
  .strict();
export type PinnedAddon = z.infer<typeof PinnedAddonSchema>;

export const PinnedAddonListSchema = z
  .array(PinnedAddonSchema)
  .max(GUILD_PINNED_ADDONS_MAX);

/** `GET .../addons` — pinned entries first, then the guild's own. */
export const GuildAddonListSchema = z
  .object({
    pinned: z.array(PinnedAddonSchema),
    addons: z.array(GuildAddonSchema),
  })
  .strict();
export type GuildAddonList = z.infer<typeof GuildAddonListSchema>;

import { z } from 'zod';
import { CharacterRoleSchema } from './characters.schema.js';
import { GuildHttpUrlSchema } from './guild-content.schema.js';

/**
 * ROK-1789 (S5 part A) — guild recruitment. WoW-plugin owned
 * (`/plugins/wow/guilds/:id/recruitment`); NOT LedgerLink wire format.
 *
 * Guild level is an explicit `recruiting` on/off switch (Q-A5 ruled A,
 * 2026-11-12); each wanted row carries its own state (ruling A2). The headline
 * state is derived by `recruitmentHeadline`, never stored.
 */
export const GUILD_RECRUITMENT_STATES = ['open', 'limited', 'closed'] as const;
/** Per-class state (ruling A2) AND the derived headline. One enum, reused by ROK-1813. */
export const GuildRecruitmentStateSchema = z.enum(GUILD_RECRUITMENT_STATES);
export type GuildRecruitmentState = z.infer<typeof GuildRecruitmentStateSchema>;

/** Blizzard class names (same spelling as web `WOW_CLASS_ICONS`). */
export const WOW_RECRUIT_CLASSES = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Death Knight',
  'Shaman',
  'Mage',
  'Warlock',
  'Monk',
  'Druid',
  'Demon Hunter',
  'Evoker',
] as const;
export type WowRecruitClass = (typeof WOW_RECRUIT_CLASSES)[number];

/** The Classic-era subset a Forever / Classic picker offers (A-D7). */
export const WOW_CLASSIC_RECRUIT_CLASSES = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
] as const satisfies readonly WowRecruitClass[];

/** Any of the 13 class names; the server does not check the game variant (A-D7). */
export const WowRecruitClassSchema = z.enum(WOW_RECRUIT_CLASSES);

export const GUILD_RECRUIT_WANTED_MAX = 12;
export const GUILD_RECRUIT_NOTE_MAX = 60;

/** One wanted class + role, with its own state (ruling A2). */
export const GuildRecruitWantedSchema = z
  .object({
    className: WowRecruitClassSchema,
    role: CharacterRoleSchema,
    state: GuildRecruitmentStateSchema,
    note: z.string().trim().max(GUILD_RECRUIT_NOTE_MAX).optional(),
  })
  .strict();
export type GuildRecruitWanted = z.infer<typeof GuildRecruitWantedSchema>;

/** What an editor saves (stored as-is in `guild_profiles.recruitment`). */
export const GuildRecruitmentSchema = z
  .object({
    /** Guild switch (Q-A5 / ruling A4): false = "Not recruiting right now"; rows, states + URL kept. */
    recruiting: z.boolean(),
    wanted: z.array(GuildRecruitWantedSchema).max(GUILD_RECRUIT_WANTED_MAX),
    applyUrl: GuildHttpUrlSchema.nullable(),
  })
  .strict()
  .refine(
    (v) => new Set(v.wanted.map((w) => `${w.className}|${w.role}`)).size === v.wanted.length,
    { message: 'Each class + role can be listed once', path: ['wanted'] },
  );
export type GuildRecruitment = z.infer<typeof GuildRecruitmentSchema>;

/**
 * Headline state (A-D3), derived and never stored — the card chip and
 * ROK-1813's `state`. Switch off → closed; on with no rows → open ("Any class
 * or role"); otherwise the best row state (open > limited > closed).
 *
 * @param r - the switch and the wanted rows of a stored recruitment
 * @returns the guild's headline recruitment state
 */
export function recruitmentHeadline(
  r: Pick<GuildRecruitment, 'recruiting' | 'wanted'>,
): GuildRecruitmentState {
  if (!r.recruiting) return 'closed';
  if (r.wanted.length === 0) return 'open';
  if (r.wanted.some((w) => w.state === 'open')) return 'open';
  return r.wanted.some((w) => w.state === 'limited') ? 'limited' : 'closed';
}

/** `PUT /plugins/wow/guilds/:id/recruitment` body (whole object, last write wins — A-D4). */
export const PutGuildRecruitmentSchema = GuildRecruitmentSchema;
export type PutGuildRecruitmentInput = GuildRecruitment;

/** `GET` / `PUT` response. `recruitment: null` = never set or cleared. */
export const GuildRecruitmentViewSchema = z
  .object({
    recruitment: GuildRecruitmentSchema.nullable(),
    /** `recruitmentHeadline(recruitment)`; null when recruitment is null. */
    state: GuildRecruitmentStateSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
    /** Username of the last editor; null when unknown or deleted. */
    updatedBy: z.string().nullable(),
    viewer: z.object({ canEdit: z.boolean() }).strict(),
  })
  .strict();
export type GuildRecruitmentView = z.infer<typeof GuildRecruitmentViewSchema>;

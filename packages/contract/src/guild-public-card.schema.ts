import { z } from 'zod';
import {
  GUILD_RECRUIT_WANTED_MAX,
  GuildRecruitWantedSchema,
  GuildRecruitmentStateSchema,
} from './guild-recruitment.schema.js';

/**
 * ROK-1813 — opt-in public visitor card for a WoW guild. WoW-plugin owned
 * (`/plugins/wow/public-guild-cards/:slug`, `/plugins/wow/guilds/:id/public-card`);
 * NOT LedgerLink wire format.
 *
 * The public DTO carries identity, a rounded size and recruitment ONLY — no
 * id, member, editor, rank, note or link. Every schema is `.strict()` so an
 * extra key fails the server-side parse instead of leaking.
 */

/** Public slug: 16 base62 characters (D1). */
export const PUBLIC_GUILD_CARD_SLUG_LENGTH = 16;
export const PublicGuildCardSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{16}$/);

/** A public wanted row: class, role, per-row state. The free-text `note` is excluded (N2). */
export const PublicGuildWantedSchema = GuildRecruitWantedSchema.pick({
  className: true,
  role: true,
  state: true,
}).strict();
export type PublicGuildWanted = z.infer<typeof PublicGuildWantedSchema>;

/** Public recruitment: derived headline, rows without notes, https-only apply URL (D7). */
export const PublicGuildRecruitmentSchema = z
  .object({
    state: GuildRecruitmentStateSchema,
    wanted: z.array(PublicGuildWantedSchema).max(GUILD_RECRUIT_WANTED_MAX),
    applyUrl: z.url({ protocol: /^https$/ }).nullable(),
  })
  .strict();
export type PublicGuildRecruitment = z.infer<
  typeof PublicGuildRecruitmentSchema
>;

/** `GET /plugins/wow/public-guild-cards/:slug` body (D5) — these fields and nothing else. */
export const PublicGuildCardSchema = z
  .object({
    name: z.string(),
    region: z.string(),
    /** NULL for Forever guilds (no realm slug). */
    realmName: z.string().nullable(),
    gameName: z.string(),
    /** Rounded to the nearest 10; null = fewer than 10 members (D6). */
    approxMemberCount: z.number().int().nonnegative().nullable(),
    /** null = recruitment never set ("Not recruiting right now"). */
    recruitment: PublicGuildRecruitmentSchema.nullable(),
  })
  .strict();
export type PublicGuildCard = z.infer<typeof PublicGuildCardSchema>;

/** `GET` / `PATCH /plugins/wow/guilds/:id/public-card` response. */
export const GuildPublicCardSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Generated on first enable and kept across off/on; null until then. */
    slug: PublicGuildCardSlugSchema.nullable(),
  })
  .strict();
export type GuildPublicCardSettings = z.infer<
  typeof GuildPublicCardSettingsSchema
>;

/** `PATCH /plugins/wow/guilds/:id/public-card` body. */
export const UpdateGuildPublicCardSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export type UpdateGuildPublicCardInput = z.infer<
  typeof UpdateGuildPublicCardSchema
>;

/** Route params of the public read. */
export const PublicGuildCardParamsSchema = z
  .object({ slug: PublicGuildCardSlugSchema })
  .strict();
export type PublicGuildCardParams = z.infer<typeof PublicGuildCardParamsSchema>;

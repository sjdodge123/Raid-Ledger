import { z } from "zod";

/**
 * ROK-1814 — guild crest: an editor-uploaded image or a preset emblem.
 * A core hub behaviour (every hub kind may have one; none requires one).
 * `GuildSummary.crest` carries the resolved public crest; the editor reads
 * `GuildCrestEditorState`. ROK-1170 later adds a `blizzard` source as an
 * additive union member — clients render an unknown source as the fallback.
 * Not part of the LedgerLink wire format.
 */

/**
 * Curated preset emblems: game-icons.net icon slugs, CC BY 3.0. The author of
 * each icon is in `GUILD_CREST_EMBLEM_CREDITS` for the credit line under the
 * picker and `docs/credits/game-icons.md`. Slugs and authors verified against
 * the github.com/game-icons/icons author folders (ROK-1814 lane 4b).
 */
export const GUILD_CREST_EMBLEM_IDS = [
  "checked-shield", // Lorc
  "crossed-swords", // Lorc
  "dragon-head", // Lorc
  "wolf-head", // Lorc
  "death-skull", // Sbed
  "oak", // Lorc
  "crown", // Lorc
  "battle-axe", // Lorc
  "eagle-emblem", // Lorc
  "griffin-symbol", // Delapouite
  "fleur-de-lys", // Delapouite
  "flame", // Carl Olsen
  "anvil", // Lorc
  "castle", // Delapouite
  "lion", // Lorc
  "bear-head", // Delapouite
] as const;
export type GuildCrestEmblemId = (typeof GUILD_CREST_EMBLEM_IDS)[number];

/** game-icons.net author per emblem (attribution for CC BY 3.0). */
export const GUILD_CREST_EMBLEM_CREDITS: Record<GuildCrestEmblemId, string> = {
  "checked-shield": "Lorc",
  "crossed-swords": "Lorc",
  "dragon-head": "Lorc",
  "wolf-head": "Lorc",
  "death-skull": "Sbed",
  oak: "Lorc",
  crown: "Lorc",
  "battle-axe": "Lorc",
  "eagle-emblem": "Lorc",
  "griffin-symbol": "Delapouite",
  "fleur-de-lys": "Delapouite",
  flame: "Carl Olsen",
  anvil: "Lorc",
  castle: "Delapouite",
  lion: "Lorc",
  "bear-head": "Delapouite",
};

/** The credit line shown under the picker grid. */
export const GUILD_CREST_EMBLEM_CREDIT_LINE =
  "Emblems by Lorc, Delapouite, Sbed and Carl Olsen, game-icons.net (CC BY 3.0)";

/**
 * 12 heraldic colours. Crest DATA, not UI chrome — the one place fixed hex is
 * allowed (spec L5): storage keeps the ids, so the hex can be retuned freely.
 */
export const GUILD_CREST_PALETTE_IDS = [
  "or",
  "argent",
  "gules",
  "azure",
  "vert",
  "purpure",
  "sable",
  "tenne",
  "sanguine",
  "murrey",
  "celeste",
  "bronze",
] as const;
export type GuildCrestPaletteId = (typeof GUILD_CREST_PALETTE_IDS)[number];

/** Hex per id — `Record` over the id list, so a missing or extra colour fails to compile. */
export const GUILD_CREST_PALETTE = {
  or: "#d4a72c",
  argent: "#e5e7eb",
  gules: "#b91c1c",
  azure: "#1d4ed8",
  vert: "#15803d",
  purpure: "#7e22ce",
  sable: "#111827",
  tenne: "#c2410c",
  sanguine: "#7f1d1d",
  murrey: "#9d174d",
  celeste: "#38bdf8",
  bronze: "#8a5a2b",
} as const satisfies Record<GuildCrestPaletteId, string>;

/** Upload limits (spec Q5): 1 MiB, 64–1024 px per edge. */
export const GUILD_CREST_UPLOAD_MAX_BYTES = 1_048_576;
export const GUILD_CREST_MIN_EDGE = 64;
export const GUILD_CREST_MAX_EDGE = 1024;

export const GuildCrestUploadErrorCodeSchema = z.enum([
  "not_image",
  "too_large",
  "too_small",
  "too_big_dimensions",
  "rate_limited",
]);
export type GuildCrestUploadErrorCode = z.infer<
  typeof GuildCrestUploadErrorCodeSchema
>;

const presetShape = {
  emblemId: z.enum(GUILD_CREST_EMBLEM_IDS),
  fg: z.enum(GUILD_CREST_PALETTE_IDS),
  bg: z.enum(GUILD_CREST_PALETTE_IDS),
};
const distinctColours = {
  check: (p: { fg: string; bg: string }): boolean => p.fg !== p.bg,
  params: { message: "Emblem and background colours must differ", path: ["bg"] },
};

/** A preset emblem: emblem id + foreground/background palette ids, fg ≠ bg. */
export const GuildCrestPresetSchema = z
  .object(presetShape)
  .strict()
  .refine(distinctColours.check, distinctColours.params);
export type GuildCrestPreset = z.infer<typeof GuildCrestPresetSchema>;

/** Public URLs of an uploaded crest (128 px `sm`, 384 px `lg`, webp). */
const uploadUrlsShape = {
  urlSm: z.string().min(1).max(300),
  urlLg: z.string().min(1).max(300),
};
export const GuildCrestUploadUrlsSchema = z.object(uploadUrlsShape).strict();
export type GuildCrestUploadUrls = z.infer<typeof GuildCrestUploadUrlsSchema>;

/** The resolved crest a hub shows. ROK-1170 adds `source: 'blizzard'`. */
export const GuildCrestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), ...uploadUrlsShape }).strict(),
  z
    .object({ source: z.literal("preset"), ...presetShape })
    .strict()
    .refine(distinctColours.check, distinctColours.params),
]);
export type GuildCrest = z.infer<typeof GuildCrestSchema>;

/** `GET /guilds/:id/crest` — editor-only: both stored crests + the pointer. */
export const GuildCrestEditorStateSchema = z
  .object({
    active: z.enum(["upload", "preset"]).nullable(),
    upload: GuildCrestUploadUrlsSchema.nullable(),
    preset: GuildCrestPresetSchema.nullable(),
    removedByStaffAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type GuildCrestEditorState = z.infer<typeof GuildCrestEditorStateSchema>;

/** `PUT /guilds/:id/crest` — show a (new) preset, the stored upload, or none. */
export const SetGuildCrestSchema = z.discriminatedUnion("active", [
  z
    .object({ active: z.literal("preset"), preset: GuildCrestPresetSchema })
    .strict(),
  z.object({ active: z.literal("upload") }).strict(),
  z.object({ active: z.null() }).strict(),
]);
export type SetGuildCrest = z.infer<typeof SetGuildCrestSchema>;

/**
 * Operator ruling Q1 — use a picture from the hub's own gallery as the crest.
 * `mediaId` is a `HubMediaItem.id`; the server copies and re-encodes it into
 * the public crest store (the gallery original stays members-only).
 */
export const SetGuildCrestFromGallerySchema = z
  .object({ mediaId: z.number().int().positive() })
  .strict();
export type SetGuildCrestFromGallery = z.infer<
  typeof SetGuildCrestFromGallerySchema
>;

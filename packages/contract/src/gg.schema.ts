import { z } from 'zod';
import { GgCardEnvelopeSchema, GgSuperlativeKeySchema } from './gg-cards.schema.js';

/**
 * ROK-2187 — "GG <year>": one frozen snapshot per user per year (stored as
 * `gg_snapshots.payload`), the owner read / archive / share DTOs, the public
 * summary (Q4 allow-list) and the admin settings / dry-run / preview DTOs.
 * A reader must accept every stored `schemaVersion` (past years stay
 * viewable, R5) — add `GgSnapshotV2Schema` to the union, never edit V1.
 */

const count = z.number().int().min(0);
const isoDateTime = z.iso.datetime({ offset: true });

/** A GG year. */
export const GgYearSchema = z.number().int().min(2020).max(2100);

/** `short` = one signal → Intro, its cards, "Welcome aboard" (R4). */
export const GgActivityTierSchema = z.enum(['short', 'full']);
export type GgActivityTier = z.infer<typeof GgActivityTierSchema>;

/** Snapshot payload, version 1. */
export const GgSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  year: GgYearSchema,
  /** Jan 1 00:00 community tz → compute time. */
  window: z.strictObject({ from: isoDateTime, to: isoDateTime }),
  tier: GgActivityTierSchema,
  computedAt: isoDateTime,
  cards: z.array(GgCardEnvelopeSchema).max(40),
});
export type GgSnapshotV1 = z.infer<typeof GgSnapshotV1Schema>;

/** Every stored snapshot version; an unknown `schemaVersion` is rejected. */
export const GgSnapshotSchema = z.discriminatedUnion('schemaVersion', [GgSnapshotV1Schema]);
export type GgSnapshot = z.infer<typeof GgSnapshotSchema>;

/** Parses a stored snapshot payload of any known version; throws otherwise. */
export function parseGgSnapshot(payload: unknown): GgSnapshot {
  return GgSnapshotSchema.parse(payload);
}

/** Share state of one year (Q5: off until the player opts in). */
export const GgShareStateDtoSchema = z.strictObject({
  shared: z.boolean(),
  /** Public slug for `/w/:slug`; `null` while not shared. */
  slug: z.string().min(16).max(64).nullable(),
  sharedAt: isoDateTime.nullable(),
});
export type GgShareStateDto = z.infer<typeof GgShareStateDtoSchema>;

/** `PUT /gg/:year/share` body. Off nulls the slug; on again mints a new one. */
export const GgShareToggleDtoSchema = z.strictObject({ shared: z.boolean() });
export type GgShareToggleDto = z.infer<typeof GgShareToggleDtoSchema>;

/** A Discord snowflake id (emoji / soundboard sound); also our copy's filename stem. */
const snowflake = z.string().regex(/^\d{1,25}$/);
/**
 * A same-origin copy served by the API at `/uploads/gg-mascot/{snowflake}-{ext}`
 * (relative to the API base; `?v=` busts caches). Extensionless on purpose:
 * prod nginx's static-asset regex would 404 a `{id}.{ext}` URL from its own disk.
 */
const mascotUploadUrl = z.string().regex(/^\/uploads\/gg-mascot\/\d{1,25}-(png|webp|gif|mp3|ogg)(\?v=[a-f0-9]{1,16})?$/);

/**
 * ROK-2187 — the community's GG mascot (app-settings `GG_MASCOT`, JSON): a
 * custom emoji + optional soundboard sound picked by the admin from its OWN
 * Discord server and COPIED into `uploads/gg-mascot/` at save time.
 */
export const GgMascotSchema = z.strictObject({
  emojiId: snowflake,
  emojiName: z.string().min(1).max(64),
  animated: z.boolean(),
  imageUrl: mascotUploadUrl,
  soundId: snowflake.nullable(),
  soundName: z.string().min(1).max(64).nullable(),
  soundUrl: mascotUploadUrl.nullable(),
  /** Discord soundboard volume, 0–1. */
  volume: z.number().min(0).max(1),
});
export type GgMascot = z.infer<typeof GgMascotSchema>;

/** The owner-read slice of the mascot (`GET /gg/:year`). */
export const GgOwnerMascotSchema = GgMascotSchema.pick({
  emojiName: true, imageUrl: true, soundUrl: true, volume: true,
});
export type GgOwnerMascot = z.infer<typeof GgOwnerMascotSchema>;

/** `PATCH /admin/gg/mascot` body — `emojiId: null` = no mascot (deletes the copies). */
export const GgMascotSelectDtoSchema = z.strictObject({
  emojiId: snowflake.nullable(),
  soundId: snowflake.nullable(),
});
export type GgMascotSelectDto = z.infer<typeof GgMascotSelectDtoSchema>;

/** `GET /admin/gg/mascot/options` — the guild's emojis + soundboard sounds. */
export const GgMascotOptionsDtoSchema = z.strictObject({
  emojis: z.array(z.strictObject({
    id: snowflake,
    name: z.string().min(1).max(64),
    animated: z.boolean(),
    /** Discord CDN preview (img-src allows cdn.discordapp.com). */
    previewUrl: z.string().max(2048),
  })),
  sounds: z.array(z.strictObject({
    id: snowflake,
    name: z.string().min(1).max(64),
    volume: z.number().min(0).max(1),
    /** `false` when the guild lost the boost level for it — not selectable. */
    available: z.boolean(),
    emojiName: z.string().max(64).nullable(),
  })),
});
export type GgMascotOptionsDto = z.infer<typeof GgMascotOptionsDtoSchema>;

/** `GET /gg/:year` — the owner's frozen snapshot, never recomputed. */
export const GgOwnerSnapshotDtoSchema = z.strictObject({
  year: GgYearSchema,
  tier: GgActivityTierSchema,
  computedAt: isoDateTime,
  cards: z.array(GgCardEnvelopeSchema).max(40),
  share: GgShareStateDtoSchema,
  /** Every year this user has a snapshot for, newest first. */
  archiveYears: z.array(GgYearSchema),
  /** Community mascot intro; absent/`null` = plain intro (live setting, not frozen). */
  mascot: GgOwnerMascotSchema.nullable().optional(),
});
export type GgOwnerSnapshotDto = z.infer<typeof GgOwnerSnapshotDtoSchema>;

/** `GET /gg/archive` — years with a snapshot (R5). */
export const GgArchiveDtoSchema = z.strictObject({
  years: z.array(z.strictObject({
    year: GgYearSchema,
    tier: GgActivityTierSchema,
    computedAt: isoDateTime,
    shared: z.boolean(),
  })),
});
export type GgArchiveDto = z.infer<typeof GgArchiveDtoSchema>;

/**
 * `GET /gg/public/:slug` — the Summary card only (Q4). Strict allow-list: no
 * other players' names (a count only), no user/Discord ids, no email.
 */
export const GgPublicSummaryDtoSchema = z.strictObject({
  year: GgYearSchema,
  displayName: z.string().min(1).max(120),
  avatarUrl: z.string().max(2048).nullable(),
  eventsAttended: count,
  hoursPlayedSeconds: count,
  topGames: z.array(z.strictObject({
    name: z.string().min(1).max(120),
    coverUrl: z.string().max(2048).nullable(),
  })).max(3),
  playedWithCount: count,
  superlative: GgSuperlativeKeySchema.nullable(),
});
export type GgPublicSummaryDto = z.infer<typeof GgPublicSummaryDtoSchema>;

/** Admin GG settings (app-settings `GG_*` keys). */
export const GgAdminSettingsDtoSchema = z.strictObject({
  /** Kill switch — `false` stops every send. */
  enabled: z.boolean(),
  /** Explicit YYYY-MM-DD; default = Monday of December's second week (Q1). */
  deliveryDate: z.iso.date(),
  /** Hour of day, community tz. Default 18. */
  deliveryHour: z.number().int().min(0).max(23),
  /** Minutes between the announcement and the first DM (R7). Default 15. */
  dmOffsetMinutes: z.number().int().min(0).max(1440),
  /** Announcement channel override; `null` = the bot's default channel. */
  channelId: z.string().regex(/^\d{1,25}$/).nullable(),
  /** Community mascot (`GG_MASCOT`); `null` = none. Changed only via `PATCH /admin/gg/mascot`. */
  mascot: GgMascotSchema.nullable().optional(),
});
export type GgAdminSettingsDto = z.infer<typeof GgAdminSettingsDtoSchema>;

/** `PATCH /admin/gg/settings` body — any subset. */
export const GgAdminSettingsUpdateDtoSchema = GgAdminSettingsDtoSchema.omit({ mascot: true }).partial();
export type GgAdminSettingsUpdateDto = z.infer<typeof GgAdminSettingsUpdateDtoSchema>;

/** `GET /admin/gg/dry-run` — what a compute + DM wave would do. */
export const GgAdminDryRunDtoSchema = z.strictObject({
  year: GgYearSchema,
  usersComputed: count,
  short: count,
  full: count,
  wouldDm: count,
  /** Set once the year's announcement went out. */
  announcedAt: isoDateTime.nullable(),
  skipped: z.strictObject({
    deactivated: count,
    optedOut: count,
    /** Gets the in-app notification only (Q6). */
    noDiscord: count,
    noActivity: count,
  }),
});
export type GgAdminDryRunDto = z.infer<typeof GgAdminDryRunDtoSchema>;

/** `POST /admin/gg/recompute` body — refused after announce unless `force`. */
export const GgAdminRecomputeDtoSchema = z.strictObject({
  year: GgYearSchema,
  force: z.boolean().optional(),
});
export type GgAdminRecomputeDto = z.infer<typeof GgAdminRecomputeDtoSchema>;

/** `GET /admin/gg/preview` — the admin's own snapshot, computed live, not stored. */
export const GgAdminPreviewDtoSchema = GgSnapshotV1Schema;
export type GgAdminPreviewDto = z.infer<typeof GgAdminPreviewDtoSchema>;

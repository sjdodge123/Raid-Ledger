import { z } from "zod";

/**
 * ROK-2099 (S3) — admin read API over the `wow-addon-errors` records the
 * Companion uploads (`wow_addon_error_records`). Admin-only; the data leaves
 * the server only through the admin export (rulings 3–4).
 *
 * A group's `signature` is the lowercase hex SHA-256 of `addon + "\n" +
 * message` (URL-safe, stable across pages and filters).
 */
export const ADDON_ERRORS_ADMIN_PAGE_SIZE = 25;
/** Hard cap on one export, newest rows first. */
export const ADDON_ERRORS_EXPORT_MAX_ROWS = 10_000;
export const ADDON_ERROR_SIGNATURE_RE = /^[0-9a-f]{64}$/;

/** Filters shared by the list and the export. */
export const AddonErrorsFiltersSchema = z.object({
  /** Exact addon name. */
  addon: z.string().trim().min(1).max(64).optional(),
  /** Only this uploader's records. */
  userId: z.coerce.number().int().positive().optional(),
  /** Records last seen at or after this instant. */
  since: z.string().datetime({ offset: true }).optional(),
  /** Case-insensitive substring of the addon name or the message. */
  q: z.string().trim().min(1).max(200).optional(),
});
export type AddonErrorsFiltersDto = z.infer<typeof AddonErrorsFiltersSchema>;

export const AddonErrorsListQuerySchema = AddonErrorsFiltersSchema.extend({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type AddonErrorsListQueryDto = z.infer<
  typeof AddonErrorsListQuerySchema
>;

export const AddonErrorsExportFormatSchema = z.enum(["json", "csv"]);
export type AddonErrorsExportFormat = z.infer<
  typeof AddonErrorsExportFormatSchema
>;

export const AddonErrorsExportQuerySchema = AddonErrorsFiltersSchema.extend({
  format: AddonErrorsExportFormatSchema.default("json"),
});
export type AddonErrorsExportQueryDto = z.infer<
  typeof AddonErrorsExportQuerySchema
>;

export const AddonErrorMemberSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
});
export type AddonErrorMemberDto = z.infer<typeof AddonErrorMemberSchema>;

export const AddonErrorCharacterSchema = z.object({
  name: z.string(),
  realm: z.string().nullable(),
});
export type AddonErrorCharacterDto = z.infer<typeof AddonErrorCharacterSchema>;

/** One `(addon, message)` group across every uploader. */
export const AddonErrorGroupSchema = z.object({
  signature: z.string().regex(ADDON_ERROR_SIGNATURE_RE),
  addon: z.string(),
  message: z.string(),
  members: z.array(AddonErrorMemberSchema),
  characters: z.array(AddonErrorCharacterSchema),
  totalCount: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Stack of the group's most recently seen record. */
  sampleStack: z.string().nullable(),
});
export type AddonErrorGroupDto = z.infer<typeof AddonErrorGroupSchema>;

export const AddonErrorGroupPageSchema = z.object({
  items: z.array(AddonErrorGroupSchema),
  /** Number of groups matching the filters (all pages). */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AddonErrorGroupPageDto = z.infer<typeof AddonErrorGroupPageSchema>;

/** One stored record of a group: one uploader + character, full stack. */
export const AddonErrorOccurrenceSchema = z.object({
  id: z.number().int(),
  member: AddonErrorMemberSchema,
  characterName: z.string().nullable(),
  characterRealm: z.string().nullable(),
  source: z.string(),
  sourceVersion: z.string(),
  count: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  stack: z.string().nullable(),
});
export type AddonErrorOccurrenceDto = z.infer<
  typeof AddonErrorOccurrenceSchema
>;

export const AddonErrorDetailSchema = z.object({
  signature: z.string().regex(ADDON_ERROR_SIGNATURE_RE),
  addon: z.string(),
  message: z.string(),
  occurrences: z.array(AddonErrorOccurrenceSchema),
});
export type AddonErrorDetailDto = z.infer<typeof AddonErrorDetailSchema>;

/** A stored (already scrubbed) record as the export writes it. */
export const AddonErrorExportRowSchema = AddonErrorOccurrenceSchema.omit({
  member: true,
}).extend({
  userId: z.number().int(),
  username: z.string(),
  addon: z.string(),
  message: z.string(),
  session: z.number().int().nullable(),
  recordHash: z.string(),
  scrubbedCount: z.number().int(),
});
export type AddonErrorExportRowDto = z.infer<typeof AddonErrorExportRowSchema>;

export const AddonErrorExportJsonSchema = z.object({
  exportedAt: z.string(),
  rows: z.array(AddonErrorExportRowSchema),
});
export type AddonErrorExportJsonDto = z.infer<
  typeof AddonErrorExportJsonSchema
>;

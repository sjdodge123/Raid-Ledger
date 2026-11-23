/**
 * ROK-2263 — backup-export tokens: a revocable `rlbx_` bearer that lets a
 * script list, create and download backups (and nothing else).
 *
 * The raw token appears ONLY in `MintBackupExportTokenResponseSchema`. Every
 * object is `.strict()` so a hash or a plaintext token cannot leak through an
 * added key on the list / item shapes.
 */
import { z } from "zod";

/** Raw export token: `rlbx_` + 43 base64url chars (32 random bytes). */
export const BACKUP_EXPORT_TOKEN_PATTERN = /^rlbx_[A-Za-z0-9_-]{43}$/;

/** At most this many live (not revoked, not expired) tokens at once. */
export const BACKUP_EXPORT_TOKEN_LIVE_CAP = 5;

/** Expiry choices offered at mint time; `null` = never expires. */
export const BACKUP_EXPORT_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

/** The pre-selected expiry in the mint form. */
export const BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS = 90;

const IsoSchema = z.iso.datetime();
const IsoOrNull = IsoSchema.nullable();

/** Who minted the token; null once that user is gone. */
const BackupExportTokenCreatorSchema = z
  .object({
    id: z.number().int().positive(),
    username: z.string(),
  })
  .strict();

/** One token as the admin list shows it — never the token or its hash. */
export const BackupExportTokenSchema = z
  .object({
    id: z.number().int().positive(),
    label: z.string(),
    /** Last 4 chars of the token, for "…ab12" display only. */
    tokenHint: z.string().length(4),
    createdBy: BackupExportTokenCreatorSchema.nullable(),
    createdAt: IsoSchema,
    expiresAt: IsoOrNull,
    lastUsedAt: IsoOrNull,
    revokedAt: IsoOrNull,
  })
  .strict();
export type BackupExportToken = z.infer<typeof BackupExportTokenSchema>;

export const BackupExportTokenListResponseSchema = z
  .object({ tokens: z.array(BackupExportTokenSchema) })
  .strict();
export type BackupExportTokenListResponse = z.infer<
  typeof BackupExportTokenListResponseSchema
>;

/** `expiresInDays`: one of 30 / 90 / 365, or null for never. */
export const BackupExportTokenExpirySchema = z
  .union([z.literal(30), z.literal(90), z.literal(365)])
  .nullable();
export type BackupExportTokenExpiry = z.infer<
  typeof BackupExportTokenExpirySchema
>;

export const MintBackupExportTokenRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    expiresInDays: BackupExportTokenExpirySchema,
  })
  .strict();
export type MintBackupExportTokenRequest = z.infer<
  typeof MintBackupExportTokenRequestSchema
>;

/** Mint response — the ONLY shape that carries the raw token. */
export const MintBackupExportTokenResponseSchema = z
  .object({
    token: z.string().regex(BACKUP_EXPORT_TOKEN_PATTERN),
    item: BackupExportTokenSchema,
  })
  .strict();
export type MintBackupExportTokenResponse = z.infer<
  typeof MintBackupExportTokenResponseSchema
>;

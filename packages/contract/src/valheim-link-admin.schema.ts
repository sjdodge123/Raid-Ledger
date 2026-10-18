/**
 * ROK-1833 — Valheim Link admin API + ingest response shapes.
 *
 * NOT part of the `valheim-link/v1` wire format (the mod's message bodies);
 * these are the Raid Ledger admin token endpoints and the ingest/blob route
 * responses. A token is per `pelican_servers` row, hashed at rest, and shown
 * exactly once — `ValheimLinkTokenIssuedSchema` is the only shape that ever
 * carries it. Every other shape is `.strict()` so a hash or token cannot leak
 * through an added key.
 */
import { z } from "zod";
import { ValheimSha256Schema } from "./valheim-link-common.schema.js";

/** Raw ingest token: `rlvl_` + 43 base64url chars (32 random bytes). */
export const VALHEIM_LINK_TOKEN_PATTERN = /^rlvl_[A-Za-z0-9_-]{43}$/;

/** The raw bearer token. Only ever appears in the issue/rotate response. */
export const ValheimLinkTokenSchema = z
  .string()
  .regex(VALHEIM_LINK_TOKEN_PATTERN);

/** Lifecycle of a server's token as the admin panel shows it. */
export const ValheimLinkTokenStateSchema = z.enum([
  "none",
  "active",
  "revoked",
]);
export type ValheimLinkTokenState = z.infer<typeof ValheimLinkTokenStateSchema>;

const IsoOrNull = z.iso.datetime().nullable();

/** One Pelican server's token status — never the token, hash or full secret. */
export const ValheimLinkTokenStatusSchema = z
  .object({
    pelicanServerId: z.number().int().positive(),
    /** Wire `serverId` = `String(pelican_servers.id)`. */
    serverId: z.string().regex(/^\d{1,12}$/),
    state: ValheimLinkTokenStateSchema,
    /** Last 4 chars of the token, for "…ab12" display only. */
    tokenHint: z.string().length(4).nullable(),
    createdAt: IsoOrNull,
    rotatedAt: IsoOrNull,
    revokedAt: IsoOrNull,
    lastUsedAt: IsoOrNull,
  })
  .strict();
export type ValheimLinkTokenStatus = z.infer<
  typeof ValheimLinkTokenStatusSchema
>;

/** `GET /admin/plugins/valheim/link-tokens`. */
export const ValheimLinkTokenListResponseSchema = z
  .object({ data: z.array(ValheimLinkTokenStatusSchema) })
  .strict();
export type ValheimLinkTokenListResponse = z.infer<
  typeof ValheimLinkTokenListResponseSchema
>;

/** Issue / rotate response — the ONLY response carrying the raw token. */
export const ValheimLinkTokenIssuedSchema = z
  .object({
    token: ValheimLinkTokenSchema,
    serverId: z.string().regex(/^\d{1,12}$/),
    status: ValheimLinkTokenStatusSchema,
  })
  .strict();
export type ValheimLinkTokenIssued = z.infer<
  typeof ValheimLinkTokenIssuedSchema
>;

/** `202` from a message route; `stale` = older/equal `capturedAt`, nothing written. */
export const ValheimLinkIngestResultSchema = z
  .object({
    status: z.enum(["accepted", "stale"]),
    missingBlobs: z.array(ValheimSha256Schema),
  })
  .strict();
export type ValheimLinkIngestResult = z.infer<
  typeof ValheimLinkIngestResultSchema
>;

/** Response from `PUT …/blobs/:sha256`. */
export const ValheimLinkBlobResultSchema = z
  .object({
    status: z.enum(["stored", "exists"]),
    sha256: ValheimSha256Schema,
  })
  .strict();
export type ValheimLinkBlobResult = z.infer<typeof ValheimLinkBlobResultSchema>;

/** Error `code` values on ingest/blob responses (the mod mirrors these). */
export const ValheimLinkIngestErrorCodeSchema = z.enum([
  "bad_json",
  "bad_gzip",
  "schema_invalid",
  "kind_mismatch",
  "captured_at_in_future",
  "bitmap_invalid",
  "blob_ref_mismatch",
  "not_png",
  "bad_ihdr",
  "png_too_large",
  "hash_mismatch",
  "invalid_token",
  "server_mismatch",
  "server_not_valheim",
  "unknown_kind",
  "payload_too_large",
  "unsupported_media",
  "rate_limited",
]);
export type ValheimLinkIngestErrorCode = z.infer<
  typeof ValheimLinkIngestErrorCodeSchema
>;

/** Error body: `{ code, message, issues? }` — issues are `{ path, code }` only. */
export const ValheimLinkIngestErrorSchema = z
  .object({
    code: ValheimLinkIngestErrorCodeSchema,
    message: z.string(),
    issues: z
      .array(z.object({ path: z.string(), code: z.string() }).strict())
      .optional(),
  })
  .strict();
export type ValheimLinkIngestError = z.infer<
  typeof ValheimLinkIngestErrorSchema
>;

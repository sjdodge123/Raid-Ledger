/**
 * ROK-1955 — Companion device tokens: the RFC 8628 device-authorization link
 * (start → approve on the web → poll) and the owner-only Devices API.
 *
 * The raw `rlcd_` token is minted at the winning poll and appears ONLY in
 * `CompanionLinkPollSuccessSchema`. Every object is `.strict()` so a hash,
 * a plaintext device/user code or a token cannot leak through an added key.
 * Field names are camelCase (repo convention); RFC 8628 uses snake_case.
 */
import { z } from "zod";
import {
  COMPANION_DISPLAY_TEXT_RE,
  rejectLoneSurrogates,
} from "./companion-common.schema.js";

/** Raw device token: `rlcd_` + 43 base64url chars (32 random bytes). */
export const COMPANION_DEVICE_TOKEN_PATTERN = /^rlcd_[A-Za-z0-9_-]{43}$/;

/** RFC 8628 §6.1 base-20 alphabet: no vowels (no words), no digits. */
export const COMPANION_USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** A normalised user code: exactly 8 alphabet chars, no separator. */
export const COMPANION_USER_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

/** The displayed user code, `XXXX-XXXX`. */
export const COMPANION_USER_CODE_DISPLAY_PATTERN =
  /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** `device_code`: 32 random bytes base64url (43 chars, no prefix). */
const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Semver-ish: `1.2.3` with an optional `-pre` / `+build` suffix. */
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

const USER_CODE_MESSAGE =
  "That code isn't valid — check the 8 letters on your computer.";

/**
 * Normalise typed user-code input: upper-case, strip `-` and whitespace.
 * Does not validate — pair with `COMPANION_USER_CODE_PATTERN`.
 */
export function normaliseCompanionUserCode(input: string): string {
  return input.toUpperCase().replace(/[-\s]/g, "");
}

/** User-code input → normalised 8-char code, or the user-facing error. */
export const CompanionUserCodeSchema = z
  .string()
  .transform(normaliseCompanionUserCode)
  .pipe(z.string().regex(COMPANION_USER_CODE_PATTERN, USER_CODE_MESSAGE));

const DisplayUserCodeSchema = z
  .string()
  .regex(COMPANION_USER_CODE_DISPLAY_PATTERN);

/** Device display name — user-editable, trimmed, 1..64, display-safe. */
export const CompanionDeviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(COMPANION_DISPLAY_TEXT_RE)
  .superRefine(rejectLoneSurrogates);

export const CompanionDeviceOsSchema = z.enum([
  "windows",
  "macos",
  "linux",
  "other",
]);
export type CompanionDeviceOs = z.infer<typeof CompanionDeviceOsSchema>;

/** What the app reports about itself when it starts a link. */
export const CompanionDeviceInfoSchema = z
  .object({
    name: CompanionDeviceNameSchema,
    os: CompanionDeviceOsSchema,
    osVersion: z
      .string()
      .max(32)
      .regex(COMPANION_DISPLAY_TEXT_RE)
      .superRefine(rejectLoneSurrogates)
      .optional(),
    appVersion: z.string().max(32).regex(APP_VERSION_PATTERN),
  })
  .strict();
export type CompanionDeviceInfo = z.infer<typeof CompanionDeviceInfoSchema>;

/** `POST /companion/v1/devices/link` body. */
export const CompanionLinkStartRequestSchema = z
  .object({ device: CompanionDeviceInfoSchema })
  .strict();
export type CompanionLinkStartRequest = z.infer<
  typeof CompanionLinkStartRequestSchema
>;

const PositiveSeconds = z.number().int().positive();

/** `POST /companion/v1/devices/link` response (RFC 8628 §3.2). */
export const CompanionLinkStartResponseSchema = z
  .object({
    deviceCode: z.string().regex(DEVICE_CODE_PATTERN),
    userCode: DisplayUserCodeSchema,
    verificationUri: z.url(),
    verificationUriComplete: z.url(),
    expiresIn: PositiveSeconds,
    interval: PositiveSeconds,
  })
  .strict();
export type CompanionLinkStartResponse = z.infer<
  typeof CompanionLinkStartResponseSchema
>;

/** `POST /companion/v1/devices/link/poll` body. */
export const CompanionLinkPollRequestSchema = z
  .object({ deviceCode: z.string().regex(DEVICE_CODE_PATTERN) })
  .strict();
export type CompanionLinkPollRequest = z.infer<
  typeof CompanionLinkPollRequestSchema
>;

const IsoSchema = z.iso.datetime();
const IsoOrNull = IsoSchema.nullable();

/** One linked device as the owner sees it — never the token or its hash. */
export const CompanionDeviceSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    os: CompanionDeviceOsSchema,
    osVersion: z.string().nullable(),
    appVersion: z.string().nullable(),
    /** Last 4 chars of the token, for "…ab12" display only. */
    tokenHint: z.string().length(4),
    createdAt: IsoSchema,
    lastUsedAt: IsoOrNull,
    /** Coarse network (IPv4 /24, IPv6 /48), never the full address. */
    lastUsedNetwork: z.string().nullable(),
    revokedAt: IsoOrNull,
    state: z.enum(["active", "revoked"]),
  })
  .strict();
export type CompanionDevice = z.infer<typeof CompanionDeviceSchema>;

/** Winning poll — the ONLY response carrying the raw token. */
export const CompanionLinkPollSuccessSchema = z
  .object({
    token: z.string().regex(COMPANION_DEVICE_TOKEN_PATTERN),
    tokenType: z.literal("Bearer"),
    device: CompanionDeviceSchema,
  })
  .strict();
export type CompanionLinkPollSuccess = z.infer<
  typeof CompanionLinkPollSuccessSchema
>;

/** RFC 8628 §3.5 poll error names. */
export const CompanionLinkPollErrorCodeSchema = z.enum([
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
  "invalid_grant",
]);
export type CompanionLinkPollErrorCode = z.infer<
  typeof CompanionLinkPollErrorCodeSchema
>;

/** Poll error body; `interval` (seconds) is present on `slow_down`. */
export const CompanionLinkPollErrorSchema = z
  .object({
    error: CompanionLinkPollErrorCodeSchema,
    interval: PositiveSeconds.optional(),
  })
  .strict();
export type CompanionLinkPollError = z.infer<
  typeof CompanionLinkPollErrorSchema
>;

/** What the web approve page shows before the explicit Approve click. */
export const CompanionLinkPreviewSchema = z
  .object({
    userCode: DisplayUserCodeSchema,
    device: CompanionDeviceInfoSchema,
    requestedAt: IsoSchema,
    expiresAt: IsoSchema,
    requestedNetwork: z.string(),
    sameNetworkAsYou: z.boolean(),
    status: z.literal("pending"),
  })
  .strict();
export type CompanionLinkPreview = z.infer<typeof CompanionLinkPreviewSchema>;

/**
 * `POST /companion/v1/devices/link/preview` body. The code rides the body,
 * not the path, so it never lands in nginx / Cloudflare access logs. Raw
 * typed input: the service normalises it and answers one 404 for a bad code.
 */
export const CompanionLinkPreviewRequestSchema = z
  .object({ userCode: z.string().max(32) })
  .strict();
export type CompanionLinkPreviewRequest = z.infer<
  typeof CompanionLinkPreviewRequestSchema
>;

/** Approve / deny; `name` lets the approver rename before approving. */
export const CompanionLinkDecisionRequestSchema = z
  .object({
    userCode: CompanionUserCodeSchema,
    decision: z.enum(["approve", "deny"]),
    name: CompanionDeviceNameSchema.optional(),
  })
  .strict();
export type CompanionLinkDecisionRequest = z.infer<
  typeof CompanionLinkDecisionRequestSchema
>;

/** `GET /companion/v1/devices`. */
export const CompanionDeviceListResponseSchema = z
  .object({ data: z.array(CompanionDeviceSchema) })
  .strict();
export type CompanionDeviceListResponse = z.infer<
  typeof CompanionDeviceListResponseSchema
>;

/** `PATCH /companion/v1/devices/:id`. */
export const CompanionDeviceRenameRequestSchema = z
  .object({ name: CompanionDeviceNameSchema })
  .strict();
export type CompanionDeviceRenameRequest = z.infer<
  typeof CompanionDeviceRenameRequestSchema
>;

/** `GET /companion/v1/device` (device-token route) — the app's self check. */
export const CompanionDeviceSelfSchema = z
  .object({
    deviceId: z.number().int().positive(),
    name: z.string(),
    createdAt: IsoSchema,
  })
  .strict();
export type CompanionDeviceSelf = z.infer<typeof CompanionDeviceSelfSchema>;

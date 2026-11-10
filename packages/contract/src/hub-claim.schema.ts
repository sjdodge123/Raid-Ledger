import { z } from "zod";
import { HubOnboardingDismissScopeSchema } from "./hub-onboarding.schema.js";

/**
 * ROK-2153 — one claim path for every hub. A hub plugin (Valheim, WoW, BG3…)
 * serves a `HubClaimProvider` (api) that lists the hub's unclaimed characters
 * (or party slots) and claims one for the viewer; core owns the routes
 * `GET/POST /guilds/:id/claim[/:candidateId]`, the "suggested" rule and the
 * error vocabulary below. Not part of the LedgerLink wire format.
 */

/** Hard cap on `candidates` in one status response; the rest is `truncated`. */
export const MAX_HUB_CLAIM_CANDIDATES = 50;

/**
 * Candidate ids are opaque and provider-scoped (WoW roster member id, a
 * Valheim armory character id, BG3 `<campaignId>:<slotKey>` e.g.
 * `12:Generic:Human:1`). The charset keeps them safe as one URL path segment;
 * an all-dots id (`.`, `..`) is refused because URL normalisation would
 * rewrite `…/claim/..` onto another route.
 */
export const HUB_CLAIM_CANDIDATE_ID_RE = /^(?!\.+$)[A-Za-z0-9_.:-]{1,200}$/;
export const HubClaimCandidateIdSchema = z
  .string()
  .regex(HUB_CLAIM_CANDIDATE_ID_RE, "Invalid candidate id");

export const HubClaimMatchSchema = z.enum(["strong", "possible"]);
export type HubClaimMatch = z.infer<typeof HubClaimMatchSchema>;

export const HubClaimMatchReasonSchema = z.enum([
  "linked_account",
  "addon_guid",
  "steam_link",
  "same_name",
  "activity",
]);
export type HubClaimMatchReason = z.infer<typeof HubClaimMatchReasonSchema>;

/**
 * A site-relative path (`/…`): one leading slash, never `//host`, and no
 * backslash or whitespace anywhere — browsers turn a backslash into `/` and
 * drop tab/CR/LF, so `/\evil.com` or `/<tab>/evil.com` would become `//evil.com`.
 */
const SITE_PATH_RE = /^\/(?![\/\\])[^\s\\]*$/;

/** An absolute `https:` URL, or a site-relative path under `SITE_PATH_RE`. */
function isSafeAvatarUrl(v: string): boolean {
  if (SITE_PATH_RE.test(v)) return true;
  return /^https:\/\/[^\s\\/?#]+(?:[/?#][^\s\\]*)?$/.test(v);
}

/** `match` and `matchReason` are both set or both null. */
function matchPairConsistent(c: {
  match: HubClaimMatch | null;
  matchReason: HubClaimMatchReason | null;
}): boolean {
  return (c.match === null) === (c.matchReason === null);
}

export const HubClaimCandidateSchema = z
  .object({
    id: HubClaimCandidateIdSchema,
    name: z.string().min(1).max(100),
    /** Provider-formatted, e.g. "Lv 60 Warrior · 412 ilvl". */
    subtitle: z.string().max(160).nullable(),
    /** `https:` URL or site-relative path — never `http:`, `data:`, `javascript:`. */
    avatarUrl: z
      .string()
      .max(500)
      .refine(isSafeAvatarUrl, "avatarUrl must be https: or site-relative")
      .nullable(),
    /** In-app page for this character, when the provider has one. */
    detailPath: z.string().max(300).regex(SITE_PATH_RE).nullable(),
    match: HubClaimMatchSchema.nullable(),
    matchReason: HubClaimMatchReasonSchema.nullable(),
  })
  .strict()
  .refine(matchPairConsistent, {
    message: "match and matchReason must both be set or both be null",
    path: ["matchReason"],
  });
export type HubClaimCandidate = z.infer<typeof HubClaimCandidateSchema>;

/** Which options step (if any) the web shows before a claim. */
export const HubClaimOptionsKindSchema = z.enum(["none", "wow_ruleset"]);
export type HubClaimOptionsKind = z.infer<typeof HubClaimOptionsKindSchema>;

interface StatusShape {
  unclaimedCount: number;
  suggested: HubClaimCandidate | null;
  candidates: HubClaimCandidate[];
  truncated: boolean;
}

/** `suggested` must be a strong match that is also in `candidates`. */
function suggestedIsStrongCandidate(s: StatusShape): boolean {
  const pick = s.suggested;
  if (pick === null) return true;
  if (pick.match !== "strong") return false;
  return s.candidates.some((c) => c.id === pick.id);
}

/** The list never exceeds the count it is a page of. */
function candidatesWithinCount(s: StatusShape): boolean {
  return s.candidates.length <= s.unclaimedCount;
}

/** `truncated` is true exactly when some unclaimed candidates were cut. */
function truncatedConsistent(s: StatusShape): boolean {
  return s.truncated === s.unclaimedCount > s.candidates.length;
}

/** `GET /guilds/:id/claim` — 404 when no active provider serves the hub. */
export const HubClaimStatusSchema = z
  .object({
    /** Slug of the plugin whose provider answered. */
    provider: z.string().min(1).max(64),
    viewerIsMember: z.boolean(),
    viewerHasClaim: z.boolean(),
    unclaimedCount: z.number().int().min(0),
    suggested: HubClaimCandidateSchema.nullable(),
    candidates: z.array(HubClaimCandidateSchema).max(MAX_HUB_CLAIM_CANDIDATES),
    truncated: z.boolean(),
    claimOptions: HubClaimOptionsKindSchema,
    /**
     * ROK-2153 N4 — the provider's dismissal round (e.g. a BG3 campaign,
     * `campaign-12`). A `claim-character` dismissal hides the prompt only for
     * the same scope. Omitted (never null) = once per hub, permanent.
     */
    dismissScope: HubOnboardingDismissScopeSchema.optional(),
  })
  .strict()
  .refine(suggestedIsStrongCandidate, {
    message: "suggested must be a strong-match candidate in candidates",
    path: ["suggested"],
  })
  .refine(candidatesWithinCount, {
    message: "candidates cannot exceed unclaimedCount",
    path: ["candidates"],
  })
  .refine(truncatedConsistent, {
    message: "truncated must equal unclaimedCount > candidates.length",
    path: ["truncated"],
  });
export type HubClaimStatus = z.infer<typeof HubClaimStatusSchema>;

/**
 * `POST /guilds/:id/claim/:candidateId` body. `options` is validated by the
 * provider's own schema (WoW: `RosterClaimRequestSchema`).
 */
export const HubClaimRequestSchema = z
  .object({
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type HubClaimRequest = z.infer<typeof HubClaimRequestSchema>;

export const HubClaimResultSchema = z
  .object({
    claimed: HubClaimCandidateSchema,
    /** The claim also made the viewer a hub member (refresh memberships). */
    becameMember: z.boolean(),
    /** The `characters` row the claim linked; null when none (BG3 party slot). */
    characterId: z.string().nullable(),
  })
  .strict();
export type HubClaimResult = z.infer<typeof HubClaimResultSchema>;

/** Providers throw `HubClaimError(code)`; core maps the code to a status. */
export const HUB_CLAIM_ERROR_CODES = [
  "HUB_CLAIM_UNAVAILABLE",
  "HUB_CLAIM_CANDIDATE_GONE",
  "HUB_CLAIM_CANDIDATE_TAKEN",
  "HUB_CLAIM_VIEWER_HAS_CLAIM",
  "HUB_CLAIM_BAD_OPTIONS",
  "HUB_CLAIM_FORBIDDEN",
] as const;
export const HubClaimErrorCodeSchema = z.enum(HUB_CLAIM_ERROR_CODES);
export type HubClaimErrorCode = z.infer<typeof HubClaimErrorCodeSchema>;

export type HubClaimErrorStatus = 400 | 403 | 404 | 409;

export const HUB_CLAIM_ERROR_STATUS: Readonly<
  Record<HubClaimErrorCode, HubClaimErrorStatus>
> = {
  HUB_CLAIM_UNAVAILABLE: 404,
  HUB_CLAIM_CANDIDATE_GONE: 404,
  HUB_CLAIM_CANDIDATE_TAKEN: 409,
  HUB_CLAIM_VIEWER_HAS_CLAIM: 409,
  HUB_CLAIM_BAD_OPTIONS: 400,
  HUB_CLAIM_FORBIDDEN: 403,
};

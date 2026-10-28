import { z } from 'zod';
import { CompanionSha256Schema, companionDisplayTextSchema } from './companion-common.schema.js';
import { BG3_ID_RE, BG3_SAVE_CONTRACT_ID, Bg3PartyMemberSchema } from './companion-bg3-save.schema.js';

// ============================================================
// ROK-1957 — the `bg3` plugin's hub read/write shapes (C4). Every object is
// `.strict()`. The party shape reuses `bg3-save` v1 (ROK-1954); this file
// never changes that wire format. Not part of LedgerLink (`ledgerlink/v1/`).
// ============================================================

/** Plugin slug (api manifest id, `HUB_PLUGIN_MANIFESTS` key). */
export const BG3_PLUGIN_ID = 'bg3' as const;
/**
 * Canonical `games.slug` of Baldur's Gate 3: the boot seed
 * (`api/seeds/games-seed.json`, IGDB-sourced) rewrites the row to this on
 * every boot (ROK-2038). Match a hub's game with `isBg3GameSlug`, not `===`.
 */
export const BG3_GAME_SLUG = 'baldurs-gate-iii' as const;
/**
 * Every `games.slug` a BG3 row can carry: the seeded/IGDB slug, plus the
 * Steam/ITAD-discovered `baldurs-gate-3` a not-yet-merged row may keep.
 */
export const BG3_GAME_SLUGS = [BG3_GAME_SLUG, 'baldurs-gate-3'] as const;
/** IGDB id of Baldur's Gate 3 — the stable key when the slug is unknown. */
export const BG3_IGDB_ID = 119171 as const;

/** True when `slug` is one of the `games.slug` values of Baldur's Gate 3. */
export function isBg3GameSlug(slug: string | null | undefined): boolean {
    return slug != null && (BG3_GAME_SLUGS as readonly string[]).includes(slug);
}
/** Hub behaviour ids (D-16): the ingest source and the retention job name. */
export const BG3_INGEST_SOURCE_ID = BG3_SAVE_CONTRACT_ID;
export const BG3_RETENTION_JOB_NAME = 'Bg3HistoryRetentionCron_prune' as const;
export const BG3_CAMPAIGN_NAME_MAX = 64;

/**
 * Party claim slot (D-10, Q-4 accepted for v1): `origin:race:n`, `n` the
 * 1-based ordinal among non-summon members with that origin + race, in save
 * order. Segments match `BG3_ID_RE`; the ordinal is 1..16 (`BG3_PARTY_MAX`).
 */
export const BG3_SLOT_KEY_RE = /^[A-Za-z0-9_]{1,64}:[A-Za-z0-9_]{1,64}:(?:[1-9]|1[0-6])$/;

const id = z.number().int().positive();
const iso = z.iso.datetime({ offset: true });
const bg3Id = z.string().regex(BG3_ID_RE);
const thumbnailUrl = z.string().min(1).max(300).nullable();
const cursor = z.string().min(1).max(200).nullable();

export const Bg3SlotKeySchema = z.string().regex(BG3_SLOT_KEY_RE, 'Invalid party slot');
/** A per-uploader campaign key (`bg3-save` `campaignKey`), as a route param. */
export const Bg3CampaignKeySchema = CompanionSha256Schema;

// ---------- reads ----------

export const Bg3CampaignSummarySchema = z.object({
    id,
    name: z.string().min(1).max(BG3_CAMPAIGN_NAME_MAX),
    hostUserId: id.nullable(),
    isActive: z.boolean(),
    lastSavedAt: iso.nullable(),
    saveCount: z.number().int().min(0),
    /** Soft archive (ROK-1958 D-11); `null` = live. */
    archivedAt: iso.nullable(),
}).strict();
export type Bg3CampaignSummary = z.infer<typeof Bg3CampaignSummarySchema>;

export const Bg3HubSettingsSchema = z.object({
    hideLocationAndScreenshots: z.boolean(),
    activeCampaignId: id.nullable(),
}).strict();
export type Bg3HubSettings = z.infer<typeof Bg3HubSettingsSchema>;

export const Bg3HubCampaignsResponseSchema = z.object({
    campaigns: z.array(Bg3CampaignSummarySchema),
    settings: Bg3HubSettingsSchema,
    canEdit: z.boolean(),
}).strict();
export type Bg3HubCampaignsResponse = z.infer<typeof Bg3HubCampaignsResponseSchema>;

export const Bg3PartyClaimSchema = z.object({
    userId: id,
    displayName: z.string().min(1),
    avatarUrl: z.string().nullable(),
}).strict();
export type Bg3PartyClaim = z.infer<typeof Bg3PartyClaimSchema>;

/** A `bg3-save` party member plus its claim slot (`null` for summons — not claimable). */
export const Bg3PartySlotSchema = z.object({
    ...Bg3PartyMemberSchema.shape,
    slotKey: Bg3SlotKeySchema.nullable(),
    claim: Bg3PartyClaimSchema.nullable(),
}).strict();
export type Bg3PartySlot = z.infer<typeof Bg3PartySlotSchema>;

/** Spoilers hidden (D-14) ⇒ `area` and `thumbnailUrl` are `null` for everyone. */
export const Bg3SnapshotSchema = z.object({
    empty: z.literal(false),
    campaignId: id,
    saveId: id,
    saveName: z.string().min(1),
    savedAt: iso,
    receivedAt: iso,
    uploaderUserId: id,
    /** ROK-1958 D-8 "Saved … by <uploader>": `display_name ?? username`; null when the user row is gone. */
    uploader: z.object({ userId: id, displayName: z.string().min(1) }).strict().nullable(),
    area: bg3Id.nullable(),
    difficulty: bg3Id,
    ruleset: bg3Id.nullable(),
    gameVersion: z.string().min(1),
    platform: z.string().min(1),
    party: z.array(Bg3PartySlotSchema),
    thumbnailUrl,
    spoilersHidden: z.boolean(),
}).strict();
export type Bg3Snapshot = z.infer<typeof Bg3SnapshotSchema>;

export const Bg3EmptySnapshotSchema = z.object({ empty: z.literal(true), campaignId: id }).strict();

/** Newest canonical save of a campaign, or `{ empty: true }` when it has none. */
export const Bg3SnapshotResponseSchema = z.discriminatedUnion('empty', [Bg3SnapshotSchema, Bg3EmptySnapshotSchema]);
export type Bg3SnapshotResponse = z.infer<typeof Bg3SnapshotResponseSchema>;

export const Bg3SessionSchema = z.object({
    startedAt: iso,
    endedAt: iso,
    saveCount: z.number().int().min(1),
    partyLevelFrom: z.number().int().min(1),
    partyLevelTo: z.number().int().min(1),
    areas: z.array(bg3Id).nullable(),
    lastSaveId: id,
    thumbnailUrl,
}).strict();
export type Bg3Session = z.infer<typeof Bg3SessionSchema>;

export const Bg3SessionsResponseSchema = z.object({
    sessions: z.array(Bg3SessionSchema),
    nextCursor: cursor,
}).strict();
export type Bg3SessionsResponse = z.infer<typeof Bg3SessionsResponseSchema>;

/** The uploader's own saves: never spoiler-hidden (D-14). */
export const Bg3MySaveSchema = z.object({
    id,
    saveName: z.string().min(1),
    savedAt: iso,
    campaignKey: Bg3CampaignKeySchema,
    campaignKeySource: z.enum(['save-folder', 'game-id']),
    campaignId: id.nullable(),
    area: bg3Id,
    thumbnailUrl,
}).strict();
export type Bg3MySave = z.infer<typeof Bg3MySaveSchema>;

export const Bg3MySavesResponseSchema = z.object({
    saves: z.array(Bg3MySaveSchema),
    nextCursor: cursor,
    defaultCampaignId: id.nullable(),
}).strict();
export type Bg3MySavesResponse = z.infer<typeof Bg3MySavesResponseSchema>;

// ---------- writes ----------

const AT_LEAST_ONE = 'Change at least one field';
const campaignName = companionDisplayTextSchema(BG3_CAMPAIGN_NAME_MAX);

export const Bg3CreateCampaignBodySchema = z.object({ name: campaignName }).strict();
export type Bg3CreateCampaignBody = z.infer<typeof Bg3CreateCampaignBodySchema>;

export const Bg3UpdateCampaignBodySchema = z.object({
    name: campaignName.optional(),
    hostUserId: id.optional(),
    /** ROK-1958 D-11: `true` archives (soft), `false` restores. */
    archived: z.boolean().optional(),
}).strict().refine(
    (b) => b.name !== undefined || b.hostUserId !== undefined || b.archived !== undefined,
    AT_LEAST_ONE,
);
export type Bg3UpdateCampaignBody = z.infer<typeof Bg3UpdateCampaignBodySchema>;

export const Bg3BindKeyBodySchema = z.object({ campaignId: id }).strict();
export type Bg3BindKeyBody = z.infer<typeof Bg3BindKeyBodySchema>;

/** `null` clears the uploader's default campaign (D-6). */
export const Bg3DefaultCampaignBodySchema = z.object({ campaignId: id.nullable() }).strict();
export type Bg3DefaultCampaignBody = z.infer<typeof Bg3DefaultCampaignBodySchema>;

export const Bg3HubSettingsBodySchema = z.object({
    hideLocationAndScreenshots: z.boolean().optional(),
    activeCampaignId: id.nullable().optional(),
}).strict().refine(
    (b) => b.hideLocationAndScreenshots !== undefined || b.activeCampaignId !== undefined,
    AT_LEAST_ONE,
);
export type Bg3HubSettingsBody = z.infer<typeof Bg3HubSettingsBodySchema>;

export const Bg3ClaimBodySchema = z.object({ slotKey: Bg3SlotKeySchema }).strict();
export type Bg3ClaimBody = z.infer<typeof Bg3ClaimBodySchema>;

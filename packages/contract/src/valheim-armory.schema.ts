/**
 * ROK-1835 — Valheim armory read + claim API shapes.
 *
 * NOT part of the `valheim-link/v1` wire format (the mod's message bodies);
 * these are Raid Ledger's own member/admin routes over the imported armory.
 * Sub-schemas (equipment, inventory, skills, pins, grid) are reused from the
 * wire schemas so the sheet a member reads is exactly what the mod sent.
 * Every shape is `.strict()` — a mod-asserted `steamId` is never returned
 * (Q10), so it cannot leak through an added key.
 */
import { z } from "zod";
import {
  ValheimPrefabIdSchema,
  ValheimSha256Schema,
  ValheimInt64StringSchema,
} from "./valheim-link-common.schema.js";
import {
  ValheimEquippedItemSchema,
  ValheimInventorySchema,
  ValheimSkillSchema,
} from "./valheim-link-character.schema.js";
import {
  ValheimMapGridSchema,
  ValheimMapPinSchema,
} from "./valheim-link-map.schema.js";

const Id = z.number().int().positive();
const Iso = z.iso.datetime();

/** How a character got its owner. */
export const ValheimClaimSourceSchema = z.enum(["auto", "manual", "admin"]);
export type ValheimClaimSource = z.infer<typeof ValheimClaimSourceSchema>;

/** The Raid Ledger user a character is claimed by. */
export const ValheimCharacterOwnerSchema = z
  .object({
    id: Id,
    username: z.string(),
    /** Discord avatar hash (or a full URL for a custom avatar), as on every user DTO. */
    avatar: z.string().nullable().optional(),
    /** ROK-1836 follow-up (additive): needed with `avatar` to build the Discord CDN URL (`buildDiscordAvatarUrl`). */
    discordId: z.string().nullable().optional(),
  })
  .strict();
export type ValheimCharacterOwner = z.infer<typeof ValheimCharacterOwnerSchema>;

/** One character in the member-visible list (no sheet, no SteamID). */
export const ValheimCharacterSummarySchema = z
  .object({
    id: Id,
    pelicanServerId: Id,
    serverName: z.string(),
    name: z.string().min(1).max(32),
    worldName: z.string(),
    claimedBy: ValheimCharacterOwnerSchema.nullable(),
    claimSource: ValheimClaimSourceSchema.nullable(),
    capturedAt: Iso,
    gameVersion: z.string(),
  })
  .strict();
export type ValheimCharacterSummary = z.infer<
  typeof ValheimCharacterSummarySchema
>;

/** `GET /plugins/valheim/armory/characters`. */
export const ValheimCharacterListResponseSchema = z
  .object({
    data: z.array(ValheimCharacterSummarySchema),
    /** ROK-1836 follow-up (additive): total rows for this server/filter. */
    total: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ValheimCharacterListResponse = z.infer<
  typeof ValheimCharacterListResponseSchema
>;

/** A map the character has on this server (one per world). */
export const ValheimCharacterMapRefSchema = z
  .object({ id: Id, worldUid: ValheimInt64StringSchema, capturedAt: Iso })
  .strict();
export type ValheimCharacterMapRef = z.infer<
  typeof ValheimCharacterMapRefSchema
>;

/** ROK-1837 — which fog-of-war layer a map byte route returns. */
export const ValheimMapFogLayerSchema = z.enum(["personal", "shared"]);
export type ValheimMapFogLayer = z.infer<typeof ValheimMapFogLayerSchema>;

/** ROK-1837 — `POST /admin/test/valheim/map-fixture` (DEMO_MODE) response. */
export const ValheimMapFixtureResponseSchema = z
  .object({
    characterId: Id,
    mapId: Id,
    pelicanServerId: Id,
    guildId: Id.nullable(),
  })
  .strict();
export type ValheimMapFixtureResponse = z.infer<
  typeof ValheimMapFixtureResponseSchema
>;

/** Base-map blob reference; `ready` = the bytes have been uploaded. */
export const ValheimMapBaseMapSchema = z
  .object({
    sha256: ValheimSha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ready: z.boolean(),
  })
  .strict();
export type ValheimMapBaseMap = z.infer<typeof ValheimMapBaseMapSchema>;

/**
 * ROK-1836 — catalogue icon as the member sees it. An atlas sprite or a
 * content-addressed file; the mod's `file` NAME is never exposed (R6: names
 * never become paths), only the blob's sha256 served by the blob route.
 */
export const ValheimCatalogIconSchema = z.union([
  z
    .object({
      kind: z.literal("atlas"),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("file"), sha256: ValheimSha256Schema }).strict(),
]);
export type ValheimCatalogIcon = z.infer<typeof ValheimCatalogIconSchema>;

/** ROK-1836 — one catalogue entry projected for the sheet (name + icon). */
export const ValheimCatalogEntrySchema = z
  .object({
    name: z.string().min(1).max(96),
    category: z.string().max(64),
    icon: ValheimCatalogIconSchema.nullable(),
  })
  .strict();
export type ValheimCatalogEntry = z.infer<typeof ValheimCatalogEntrySchema>;

/**
 * ROK-1882 — a skill id: `Skills.SkillType.ToString()` (a vanilla name such as
 * `Swords`, or a signed integer string for a modded skill). Same pattern as
 * `ValheimSkillSchema.id` in the valheim-link wire contract.
 */
export const ValheimSkillIdSchema = z.string().regex(/^-?[A-Za-z0-9_]{1,64}$/);

/** ROK-1882 — one play day's net skill gain, effective levels (level + progress fraction). */
export const ValheimSkillTrendDaySchema = z
  .object({
    /** The bucket date in the game server's timezone — no time, no zone. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** skillId → end − start; only |gain| ≥ 0.05. Negative = a net loss (death). */
    gains: z.record(ValheimSkillIdSchema, z.number()),
  })
  .strict();
export type ValheimSkillTrendDay = z.infer<typeof ValheimSkillTrendDaySchema>;

/** ROK-1882 — the character's last 3 play days (days actually played), newest first. */
export const ValheimSkillTrendSchema = z
  .object({ days: z.array(ValheimSkillTrendDaySchema).max(3) })
  .strict();
export type ValheimSkillTrend = z.infer<typeof ValheimSkillTrendSchema>;

/**
 * `GET /plugins/valheim/armory/characters/:id` — summary plus the full sheet.
 * ROK-1836 (additive): `items` carries the catalogue subset for ONLY the
 * prefabs this sheet references (equipment + inventory + trophies) and
 * `atlas` the icon atlas blob. With no catalogue row for the server + game
 * version the API answers `items: {}` and `atlas: null` (the keys are
 * optional only so older readers of the shape keep parsing).
 */
export const ValheimCharacterDetailSchema =
  ValheimCharacterSummarySchema.extend({
    equipment: z.array(ValheimEquippedItemSchema),
    inventory: ValheimInventorySchema,
    skills: z.array(ValheimSkillSchema),
    trophies: z.array(ValheimPrefabIdSchema),
    maps: z.array(ValheimCharacterMapRefSchema),
    items: z.record(ValheimPrefabIdSchema, ValheimCatalogEntrySchema).optional(),
    atlas: ValheimMapBaseMapSchema.nullable().optional(),
    /** ROK-1836 follow-up (additive): the server's community hub (ROK-1831), null when the server is not a hub. */
    hubId: Id.nullable().optional(),
    /** ROK-1882 (additive): skill gains over the last 3 play days; the API always sends it (`days: []` when none). */
    skillTrend: ValheimSkillTrendSchema.optional(),
  }).strict();
export type ValheimCharacterDetail = z.infer<
  typeof ValheimCharacterDetailSchema
>;

/**
 * `GET /plugins/valheim/armory/characters/:id/maps/:mapId` — metadata only; fog
 * bitmaps and blob bytes are served by V7 (Q7). Pin labels are free text.
 */
export const ValheimMapMetaSchema = z
  .object({
    id: Id,
    worldUid: ValheimInt64StringSchema,
    grid: ValheimMapGridSchema,
    pins: z.array(ValheimMapPinSchema),
    hasSharedExplored: z.boolean(),
    baseMap: ValheimMapBaseMapSchema.nullable(),
    capturedAt: Iso,
  })
  .strict();
export type ValheimMapMeta = z.infer<typeof ValheimMapMetaSchema>;

/** `PUT /admin/plugins/valheim/armory/characters/:id/owner` — null unassigns. */
export const ValheimAssignOwnerBodySchema = z
  .object({ userId: Id.nullable() })
  .strict();
export type ValheimAssignOwnerBody = z.infer<
  typeof ValheimAssignOwnerBodySchema
>;

/** Owner-change audit actions. */
export const ValheimClaimActionSchema = z.enum([
  "auto_attach",
  "claim",
  "admin_assign",
  "admin_unassign",
  "auto_detach",
]);
export type ValheimClaimAction = z.infer<typeof ValheimClaimActionSchema>;

/** One audit row; `actorUserId` null = the system (Steam auto-match). */
export const ValheimClaimEventSchema = z
  .object({
    id: Id,
    profileId: Id,
    action: ValheimClaimActionSchema,
    fromUserId: Id.nullable(),
    toUserId: Id.nullable(),
    actorUserId: Id.nullable(),
    createdAt: Iso,
    /** ROK-1836 follow-up (additive): resolved users for the ids above, for display. */
    fromUser: ValheimCharacterOwnerSchema.nullable().optional(),
    toUser: ValheimCharacterOwnerSchema.nullable().optional(),
    actor: ValheimCharacterOwnerSchema.nullable().optional(),
  })
  .strict();
export type ValheimClaimEvent = z.infer<typeof ValheimClaimEventSchema>;

/** `GET /admin/plugins/valheim/armory/characters/:id/claim-events`, newest first. */
export const ValheimClaimEventListResponseSchema = z
  .object({ data: z.array(ValheimClaimEventSchema) })
  .strict();
export type ValheimClaimEventListResponse = z.infer<
  typeof ValheimClaimEventListResponseSchema
>;

/**
 * ROK-1889 — `GET …/servers/:id/chest-focus`: one visible chest found by
 * prefab + position (the Map tab's `focus=chest:<prefab>@x,z` deep link).
 * Display fields only — never a row id or creatorPlayerId; a hidden personal
 * chest is a 404 exactly like a missing one.
 */
export const ValheimChestFocusSchema = z
  .object({
    prefab: z.string(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    privacy: z.enum(['shared', 'personal']),
    vehicle: z.boolean(),
    slots: z.number().int(),
    usedSlots: z.number().int(),
    held: z.object({ prefab: z.string(), count: z.number().int() }).strict().nullable(),
  })
  .strict();
export type ValheimChestFocus = z.infer<typeof ValheimChestFocusSchema>;

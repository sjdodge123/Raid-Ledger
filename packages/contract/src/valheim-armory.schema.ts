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
    avatar: z.string().nullable().optional(),
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

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

/** `GET /plugins/valheim/characters`. */
export const ValheimCharacterListResponseSchema = z
  .object({ data: z.array(ValheimCharacterSummarySchema) })
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

/** `GET /plugins/valheim/characters/:id` — summary plus the full sheet. */
export const ValheimCharacterDetailSchema =
  ValheimCharacterSummarySchema.extend({
    equipment: z.array(ValheimEquippedItemSchema),
    inventory: ValheimInventorySchema,
    skills: z.array(ValheimSkillSchema),
    trophies: z.array(ValheimPrefabIdSchema),
    maps: z.array(ValheimCharacterMapRefSchema),
  }).strict();
export type ValheimCharacterDetail = z.infer<
  typeof ValheimCharacterDetailSchema
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
 * `GET /plugins/valheim/characters/:id/maps/:mapId` — metadata only; fog
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

/** `PUT /admin/plugins/valheim/characters/:id/owner` — null unassigns. */
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
  })
  .strict();
export type ValheimClaimEvent = z.infer<typeof ValheimClaimEventSchema>;

/** `GET /admin/plugins/valheim/characters/:id/claim-events`, newest first. */
export const ValheimClaimEventListResponseSchema = z
  .object({ data: z.array(ValheimClaimEventSchema) })
  .strict();
export type ValheimClaimEventListResponse = z.infer<
  typeof ValheimClaimEventListResponseSchema
>;

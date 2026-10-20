/**
 * ROK-1835 — pure importer mappers: a stored `valheim_link_snapshots` row's
 * payload is RE-validated with the contract schema for its kind (D5, R7),
 * then reshaped into armory row values. No I/O here.
 */
import {
  ValheimLinkMessageSchema,
  type ValheimCharacterMessage,
  type ValheimItemDefinition,
  type ValheimItemsMessage,
  type ValheimLinkMessage,
  type ValheimMapMessage,
} from '@raid-ledger/contract';
import type { z } from 'zod';
import type {
  NewValheimItemCatalog,
  NewValheimMap,
  NewValheimProfile,
  ValheimItemCatalogEntryRow,
} from '../../../drizzle/schema';

/** Stored known_items / known_recipes cap (spec: ≤8192 each). */
export const ARMORY_KNOWN_LIST_MAX = 8192;
const DETAIL_MAX = 200;
const ISSUES_SHOWN = 3;

/** The snapshot columns the importer reads (payload is untrusted jsonb). */
export interface ArmorySnapshot {
  id: number;
  pelicanServerId: number;
  kind: string;
  steamId: string | null;
  playerId: string | null;
  worldUid: string | null;
  /** `received_at::text` — the row version the importer guards on. */
  receivedAt: string;
  payload: unknown;
}

/** Re-validation result; `detail` carries issue paths/codes only. */
export type ArmoryValidation =
  { ok: true; message: ValheimLinkMessage } | { ok: false; detail: string };

/** `invalid:<path>:<code>;…` — never the payload text (pins are free text). */
function issueDetail(error: z.ZodError): string {
  const parts = error.issues
    .slice(0, ISSUES_SHOWN)
    .map((i) => `${i.path.map(String).join('.') || '_'}:${i.code}`);
  return `invalid:${parts.join(';')}`.slice(0, DETAIL_MAX);
}

/** Whether the row's key columns equal the payload identity. */
function keyMatches(snap: ArmorySnapshot, msg: ValheimLinkMessage): boolean {
  if (msg.kind === 'items' || msg.kind === 'recipes') {
    return snap.steamId === null && snap.playerId === null;
  }
  if (msg.kind === 'containers') {
    return (
      snap.steamId === null &&
      snap.playerId === null &&
      snap.worldUid === msg.worldUid
    );
  }
  const c = msg.character;
  return (
    snap.steamId === c.steamId &&
    snap.playerId === c.playerId &&
    snap.worldUid === c.worldUid
  );
}

/**
 * Parse the payload with `ValheimLinkMessageSchema` and check `kind` + key
 * columns against it. A failure must leave armory rows untouched (R7).
 */
export function validateSnapshotPayload(
  snap: ArmorySnapshot,
): ArmoryValidation {
  const parsed = ValheimLinkMessageSchema.safeParse(snap.payload);
  if (!parsed.success) return { ok: false, detail: issueDetail(parsed.error) };
  const msg = parsed.data;
  if (msg.kind !== snap.kind)
    return { ok: false, detail: 'invalid:kind_mismatch' };
  if (!keyMatches(snap, msg))
    return { ok: false, detail: 'invalid:key_mismatch' };
  return { ok: true, message: msg };
}

/** Cap a known-prefab list at {@link ARMORY_KNOWN_LIST_MAX}. */
export function capKnownList(list: string[]): {
  list: string[];
  truncated: boolean;
} {
  if (list.length <= ARMORY_KNOWN_LIST_MAX) return { list, truncated: false };
  return { list: list.slice(0, ARMORY_KNOWN_LIST_MAX), truncated: true };
}

/** Both known lists capped; `truncated` names the ones that were cut. */
function capKnownLists(msg: ValheimCharacterMessage): {
  items: string[];
  recipes: string[];
  truncated: string[];
} {
  const items = capKnownList(msg.knownItems);
  const recipes = capKnownList(msg.knownRecipes);
  const truncated: string[] = [];
  if (items.truncated) truncated.push('knownItems');
  if (recipes.truncated) truncated.push('knownRecipes');
  return { items: items.list, recipes: recipes.list, truncated };
}

/**
 * `valheim_profiles` values for a character message. Claim columns are
 * deliberately absent — identity is L3's (`onProfileUpserted`), never the
 * mod's. `truncated` names any known list that was cut.
 */
export function toProfileValues(
  snap: ArmorySnapshot,
  msg: ValheimCharacterMessage,
): { values: NewValheimProfile; truncated: string[] } {
  const { items, recipes, truncated } = capKnownLists(msg);
  const c = msg.character;
  const values: NewValheimProfile = {
    pelicanServerId: snap.pelicanServerId,
    steamId: c.steamId,
    playerId: c.playerId,
    worldUid: c.worldUid,
    worldName: c.worldName,
    name: c.name,
    gameVersion: msg.gameVersion,
    modVersion: msg.modVersion,
    capturedAt: new Date(msg.capturedAt),
    equipment: msg.equipment,
    inventory: msg.inventory,
    skills: msg.skills,
    trophies: msg.trophies,
    knownItems: items,
    knownRecipes: recipes,
    sourceSnapshotId: snap.id,
  };
  return { values, truncated };
}

/** `valheim_maps` values; `profileId` is resolved by the caller (D3). */
export function toMapValues(
  snap: ArmorySnapshot,
  msg: ValheimMapMessage,
  profileId: number | null,
): NewValheimMap {
  const c = msg.character;
  return {
    pelicanServerId: snap.pelicanServerId,
    steamId: c.steamId,
    playerId: c.playerId,
    worldUid: c.worldUid,
    profileId,
    textureSize: msg.grid.textureSize,
    pixelSizeMetres: msg.grid.pixelSizeMetres,
    explored: msg.explored,
    sharedExplored: msg.sharedExplored,
    pins: msg.pins,
    baseMapSha256: msg.baseMap?.sha256 ?? null,
    baseMapWidth: msg.baseMap?.width ?? null,
    baseMapHeight: msg.baseMap?.height ?? null,
    gameVersion: msg.gameVersion,
    capturedAt: new Date(msg.capturedAt),
    sourceSnapshotId: snap.id,
  };
}

/** A file icon keeps only its blob sha256; `file` is display-only (R6). */
function toEntry(item: ValheimItemDefinition): ValheimItemCatalogEntryRow {
  const { icon } = item;
  return {
    name: item.name,
    category: item.category,
    maxStack: item.maxStack,
    maxQuality: item.maxQuality,
    variants: item.variants,
    icon:
      icon?.kind === 'file'
        ? { kind: 'file', file: icon.file, sha256: icon.blob?.sha256 ?? null }
        : icon,
  };
}

/** `valheim_item_catalogs` values, `items` keyed by prefab (D4). */
export function toCatalogValues(
  snap: ArmorySnapshot,
  msg: ValheimItemsMessage,
): NewValheimItemCatalog {
  const items: Record<string, ValheimItemCatalogEntryRow> = {};
  for (const item of msg.items) items[item.prefab] = toEntry(item);
  return {
    pelicanServerId: snap.pelicanServerId,
    gameVersion: msg.gameVersion,
    locale: msg.locale,
    atlasSha256: msg.atlas?.sha256 ?? null,
    atlasWidth: msg.atlas?.width ?? null,
    atlasHeight: msg.atlas?.height ?? null,
    items,
    capturedAt: new Date(msg.capturedAt),
    sourceSnapshotId: snap.id,
  };
}

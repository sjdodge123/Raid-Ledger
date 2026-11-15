import {
  ADDON_LOOT_DEDUP_BUCKET_SECONDS,
  type AddonLootDrop,
  type AddonLootExport,
} from '@raid-ledger/contract';
import type { GuildLootDropInsert } from '../../../drizzle/schema';
import {
  fromUnix,
  guildNameKey,
  type AddonApplyContext,
} from './addon-import-apply.types';

/**
 * ROK-2184 ruling Q5 — the pure pieces of the loot dedup key. The stored
 * unique index (`uq_guild_loot_drops_dedupe`) is (game, region, guild key,
 * looter key, item, quantity, at bucket, instance); these helpers build the
 * per-guild part of it so the preview counts exactly what the insert skips.
 */

/** floor(at / 120): two drops in one 120 s bucket share a key. */
export function lootAtBucket(at: number): number {
  return Math.floor(at / ADDON_LOOT_DEDUP_BUCKET_SECONDS);
}

/** `looterGuid ?? looterName` — the GUID when the addon knew it. */
export function lootLooterKey(
  drop: Pick<AddonLootDrop, 'looterGuid' | 'looterName'>,
): string {
  return drop.looterGuid ?? drop.looterName.normalize('NFC').trim();
}

/** The dedup key's fields, as stored or as sent. */
export interface LootKeyParts {
  looterKey: string;
  itemId: number;
  quantity: number;
  atBucket: number;
  instanceId: number | null;
}

/** One string per dedup key within a guild scope (game + region + guild). */
export function lootKeyString(k: LootKeyParts): string {
  return [k.looterKey, k.itemId, k.quantity, k.atBucket, k.instanceId ?? '']
    .map(String)
    .join('\u0000');
}

export function lootKeyOfDrop(drop: AddonLootDrop): LootKeyParts {
  return {
    looterKey: lootLooterKey(drop),
    itemId: drop.itemId,
    quantity: drop.quantity,
    atBucket: lootAtBucket(drop.at),
    instanceId: drop.instanceId ?? null,
  };
}

/** Drops that would insert: key not stored and first of its key in the payload. */
export function countNewDrops(
  drops: AddonLootDrop[],
  storedKeys: ReadonlySet<string>,
): number {
  const seen = new Set(storedKeys);
  let fresh = 0;
  for (const drop of drops) {
    const key = lootKeyString(lootKeyOfDrop(drop));
    if (!seen.has(key)) fresh += 1;
    seen.add(key);
  }
  return fresh;
}

/** The row one drop stores (dedup columns from `lootKeyOfDrop`). */
export function lootDropRow(
  drop: AddonLootDrop,
  payload: AddonLootExport,
  ctx: AddonApplyContext,
): GuildLootDropInsert {
  return {
    gameId: ctx.gameId,
    region: ctx.region,
    guildKey: guildNameKey(payload.who.guildName),
    ...lootKeyOfDrop(drop),
    looterName: drop.looterName,
    looterGuid: drop.looterGuid ?? null,
    quality: drop.quality ?? null,
    link: drop.link ?? null,
    method: drop.method,
    difficultyId: drop.difficultyId ?? null,
    encounterId: drop.encounterId ?? null,
    encounterName: drop.encounterName ?? null,
    droppedAt: fromUnix(drop.at),
    reportedByUserId: ctx.userId,
    reportedByCharacterId: ctx.characterId,
    payloadSha256: ctx.sha256,
  };
}

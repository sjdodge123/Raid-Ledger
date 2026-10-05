import { and, eq, ne } from 'drizzle-orm';
import { characters } from '../../../drizzle/schema';
import type { AddonBindingResult } from './addon-import.binding';
import { AddonImportError } from './addon-import.errors';
import type { AddonApplyContext } from './addon-import-apply.types';

/**
 * ROK-1724 §4.3 — write the binding's character-row changes (GUID pin,
 * confirmed ruleset, class/level) on apply. Touches ONLY the importer's own
 * character (`ctx.characterId`, already ownership-checked by the service).
 */

export const GUID_ALREADY_LINKED_MESSAGE =
  'That in-game character is already linked to another Raid Ledger character.';

/** Column updates implied by a binding; empty when nothing changes. */
export function bindingUpdates(
  binding: AddonBindingResult,
): Partial<typeof characters.$inferInsert> {
  const set: Partial<typeof characters.$inferInsert> = {};
  if (binding.pinGuid !== null) set.addonGuid = binding.pinGuid;
  if (binding.setRuleset !== undefined) set.ruleset = binding.setRuleset;
  if (binding.diff.class) set.class = binding.diff.class.to;
  if (binding.diff.level) set.level = binding.diff.level.to;
  return set;
}

/**
 * Pre-check the `idx_characters_addon_guid` unique index. A violation would
 * poison the transaction (postgres.js), so check first, never catch-retry.
 */
export async function assertGuidFree(
  ctx: AddonApplyContext,
  guid: string,
): Promise<void> {
  const [holder] = await ctx.tx
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.gameId, ctx.gameId),
        eq(characters.region, ctx.region),
        eq(characters.addonGuid, guid),
        ne(characters.id, ctx.characterId),
      ),
    )
    .limit(1);
  if (holder) {
    throw new AddonImportError('INVALID_PAYLOAD', GUID_ALREADY_LINKED_MESSAGE);
  }
}

/** Apply the binding to the character row. Returns whether a row changed. */
export async function applyBinding(
  ctx: AddonApplyContext,
  binding: AddonBindingResult,
): Promise<boolean> {
  const set = bindingUpdates(binding);
  if (Object.keys(set).length === 0) return false;
  if (set.addonGuid) await assertGuidFree(ctx, set.addonGuid);
  await ctx.tx
    .update(characters)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(characters.id, ctx.characterId));
  return true;
}

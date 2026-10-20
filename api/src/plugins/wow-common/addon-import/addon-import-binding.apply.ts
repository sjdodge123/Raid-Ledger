import { and, eq, ne } from 'drizzle-orm';
import { characters } from '../../../drizzle/schema';
import { lockAddonGuid } from './addon-import.locks';
import type { AddonBindingResult } from './addon-import.binding';
import { AddonImportError } from './addon-import.errors';
import type { AddonApplyContext } from './addon-import-apply.types';
import { logGuidAudit } from './addon-import.guid-audit';

/**
 * ROK-1724 §4.3 — write the binding's character-row changes (GUID pin,
 * confirmed ruleset, class/level) on apply. Touches ONLY the importer's own
 * character (`ctx.characterId`, already ownership-checked by the service).
 */

/**
 * `pg_advisory_xact_lock(class, key)` namespace for GUID pins. Distinct from
 * the rate limit's class (1724), so the two keyspaces never collide. Lives
 * with THE import lock order in `addon-import.locks.ts` (ROK-1794).
 */
export { ADDON_GUID_LOCK_CLASS } from './addon-import.locks';

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
  if (binding.setRace !== undefined) set.race = binding.setRace;
  if (binding.setGender !== undefined) set.gender = binding.setGender;
  return set;
}

/**
 * Pre-check the `idx_characters_addon_guid` unique index. A violation would
 * poison the transaction (postgres.js), so check first, never catch-retry.
 * The check runs under a tx-scoped advisory lock on (game, region, GUID):
 * a second import pinning the same GUID to ANOTHER character blocks until
 * the first commits, then sees it as the holder → 422, never a 500. On
 * apply the run already holds it (`lockImportScope`, taken BEFORE the guild
 * lock — ROK-1794); this re-entry keeps the check safe for any caller.
 */
export async function assertGuidFree(
  ctx: AddonApplyContext,
  guid: string,
): Promise<void> {
  await lockAddonGuid(ctx.tx, ctx.gameId, ctx.region, guid);
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
  const [row] = await ctx.tx
    .update(characters)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(characters.id, ctx.characterId))
    .returning({ name: characters.name });
  if (set.addonGuid && row) await auditPin(ctx, set.addonGuid, row.name);
  return true;
}

/** ROK-1756 — the GUID is free (checked above), so this pin is its claim. */
function auditPin(
  ctx: AddonApplyContext,
  guid: string,
  name: string,
): Promise<void> {
  return logGuidAudit(ctx.tx, {
    action: 'addon_guid_claimed',
    actorId: ctx.userId,
    ownerId: ctx.userId,
    characterId: ctx.characterId,
    guid,
    name,
    gameId: ctx.gameId,
    region: ctx.region,
  });
}

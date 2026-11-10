import { NotFoundException } from '@nestjs/common';
import { eq, type SQL } from 'drizzle-orm';
import type {
  AddonImportRequestDto,
  AddonImportResultDto,
  WowForeverRuleset,
  WowRegion,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type {
  AddonBindingCharacter,
  AddonBindingResult,
} from './addon-import.binding';
import { bindEverySection } from './addon-import.binding-paste';
import { applyBinding } from './addon-import-binding.apply';
import type { DecodedAddonPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { lockImportScope } from './addon-import.locks';
import type {
  AddonApplyContext,
  AddonImportTx,
} from './addon-import-apply.types';
import {
  buildPasteResult,
  pasteSections,
  runPaste,
  shouldApplyBinding,
  withPendingBindingStatus,
  type PasteSectionRun,
} from './addon-import.paste-run';
import { raidPullScope, withRaidPullScope } from './addon-import-raid.scope';

/**
 * ROK-1738 — the per-character import run, extracted from
 * `AddonImportService` so the create route (`addon-import-create.service`)
 * runs the exact same bind → preview/apply → binding-write path on its own
 * transaction. Nothing here opens a transaction.
 */

/** The row the binding reads: owner-checked already, plus slug + GUID. */
export interface LoadedCharacter {
  id: string;
  gameId: number;
  binding: AddonBindingCharacter;
}

/** The request flags the run reads (both request schemas carry them). */
export type ImportRunRequest = Pick<
  AddonImportRequestDto,
  'dryRun' | 'confirm'
>;

type CharacterRow = typeof schema.characters.$inferSelect;

/** Map a `characters ⋈ games` row to what the binding reads. */
export function toLoadedCharacter(
  c: CharacterRow,
  slug: string,
): LoadedCharacter {
  return {
    id: c.id,
    gameId: c.gameId,
    binding: {
      gameSlug: slug,
      name: c.name,
      region: c.region,
      ruleset: c.ruleset,
      class: c.class,
      level: c.level,
      addonGuid: c.addonGuid,
      race: c.race,
      gender: c.gender,
      externalId: c.externalId,
      lastSyncedAt: c.lastSyncedAt,
    },
  };
}

/** First character (+ its game slug) matching `where`, or null. */
export async function findLoadedCharacter(
  db: AddonImportTx,
  where: SQL | undefined,
): Promise<{ userId: number; character: LoadedCharacter } | null> {
  const [row] = await db
    .select({ c: schema.characters, slug: schema.games.slug })
    .from(schema.characters)
    .innerJoin(schema.games, eq(schema.games.id, schema.characters.gameId))
    .where(where)
    .limit(1);
  if (!row) return null;
  return {
    userId: row.c.userId,
    character: toLoadedCharacter(row.c, row.slug),
  };
}

/** Load the (already owner-checked) character; missing → `WRONG_GAME`. */
export async function loadImportCharacter(
  db: AddonImportTx,
  characterId: string,
): Promise<LoadedCharacter> {
  const found = await findLoadedCharacter(
    db,
    eq(schema.characters.id, characterId),
  );
  if (!found) throw new AddonImportError('WRONG_GAME');
  return found.character;
}

/**
 * Bind EVERY section (Codex P2) against the character; any section's reject
 * rejects the whole paste before anything runs. Pure — throws `errors[0]`.
 * `inferredRuleset` (ROK-1739) is the realm map's fallback for a null
 * export ruleset — an opt-in `RULESET_CHANGED`, never auto-written.
 */
export function bindPaste(
  paste: DecodedAddonPaste,
  character: LoadedCharacter,
  request: ImportRunRequest,
  inferredRuleset?: WowForeverRuleset,
): AddonBindingResult {
  const binding = bindEverySection(
    pasteSections(paste).map((s) => s.payload),
    character.binding,
    { dryRun: request.dryRun, confirm: request.confirm, inferredRuleset },
  );
  const [firstError] = binding.errors;
  if (firstError) throw firstError;
  return binding;
}

/** Preview/apply every section + the binding's writes, on the caller's tx. */
export async function runForCharacter(
  tx: AddonImportTx,
  userId: number,
  character: LoadedCharacter,
  paste: DecodedAddonPaste,
  binding: AddonBindingResult,
  request: ImportRunRequest,
): Promise<AddonImportResultDto> {
  const ctx = {
    tx,
    userId,
    characterId: character.id,
    gameId: character.gameId,
    region: character.binding.region as WowRegion,
    pendingGuid: binding.pinGuid,
  };
  // ROK-1794 — THE lock order (GUID, then guild) → row (ROK-2159) first.
  if (!request.dryRun) await lockAndRecheckOwner(ctx, character, paste);
  const runs = withPendingBindingStatus(
    await runPaste(ctx, paste, request.dryRun),
    binding,
    request.dryRun,
  );
  return finishRun({ ...ctx, sha256: '' }, runs, binding, request.dryRun);
}

/**
 * ROK-2159 — take THE import locks, then `FOR NO KEY UPDATE` the character
 * row and re-check its owner on the SAME tx. NO KEY UPDATE still conflicts
 * with the `FOR UPDATE` that Change owner and unlink take (Postgres row-lock
 * table: FOR UPDATE conflicts with every mode), so the race serialises the
 * same; unlike FOR UPDATE it lets FOR KEY SHARE through, so FK inserts that
 * reference this character (signups, audit rows) are not blocked meanwhile. The pre-tx owner check
 * (`characters.findOne`) races an admin Change owner, which locks GUID →
 * name → row (`character-owner.admin.tx.ts::lockCharacter`): without this
 * the import waited on that row lock and then wrote the old owner's
 * snapshot onto the moved character. The GUID locked is the one the apply
 * pins, else the one the row already carries, so both sides queue on the
 * same lock (1) before the row lock — never row-then-GUID.
 */
async function lockAndRecheckOwner(
  ctx: Pick<
    AddonApplyContext,
    'tx' | 'userId' | 'gameId' | 'region' | 'pendingGuid'
  >,
  character: LoadedCharacter,
  paste: DecodedAddonPaste,
): Promise<void> {
  const { tx, gameId, region } = ctx;
  const guid = ctx.pendingGuid ?? character.binding.addonGuid;
  await lockImportScope(tx, { gameId, region, guid, paste });
  const [row] = await tx
    .select({ userId: schema.characters.userId })
    .from(schema.characters)
    .where(eq(schema.characters.id, character.id))
    .for('no key update');
  // Deleted meanwhile: the same 404 the pre-tx owner check gives (findOneOwned).
  if (!row) throw new NotFoundException(`Character ${character.id} not found`);
  if (row.userId !== ctx.userId) throw new AddonImportError('CHARACTER_MOVED');
}

/**
 * The binding's writes, then the 200 body. Lead ruling: a stale export writes
 * NOTHING — binding updates too (a mixed paste skips them only when EVERY
 * section is stale). An applied raid section tags the body with its pull
 * scope for the post-commit cache hook (ROK-1917).
 */
async function finishRun(
  ctx: AddonApplyContext,
  runs: PasteSectionRun[],
  binding: AddonBindingResult,
  dryRun: boolean,
): Promise<AddonImportResultDto> {
  if (!dryRun && shouldApplyBinding(runs)) {
    const [head] = runs;
    await applyBinding({ ...ctx, sha256: head?.decoded.sha256 ?? '' }, binding);
  }
  const res = buildPasteResult(runs, binding);
  return dryRun ? res : withRaidPullScope(res, raidPullScope(runs, ctx));
}

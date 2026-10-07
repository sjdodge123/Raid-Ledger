import { eq, type SQL } from 'drizzle-orm';
import type {
  AddonImportRequestDto,
  AddonImportResultDto,
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
import type { AddonImportTx } from './addon-import-apply.types';
import {
  buildPasteResult,
  pasteSections,
  runPaste,
  shouldApplyBinding,
} from './addon-import.paste-run';

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
 */
export function bindPaste(
  paste: DecodedAddonPaste,
  character: LoadedCharacter,
  request: ImportRunRequest,
): AddonBindingResult {
  const binding = bindEverySection(
    pasteSections(paste).map((s) => s.payload),
    character.binding,
    { dryRun: request.dryRun, confirm: request.confirm },
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
  };
  const runs = await runPaste(ctx, paste, request.dryRun);
  // Lead ruling: a stale export writes NOTHING — binding updates too
  // (a mixed paste skips them only when EVERY section is stale).
  if (!request.dryRun && shouldApplyBinding(runs)) {
    const [head] = runs;
    await applyBinding({ ...ctx, sha256: head?.decoded.sha256 ?? '' }, binding);
  }
  return buildPasteResult(runs, binding);
}

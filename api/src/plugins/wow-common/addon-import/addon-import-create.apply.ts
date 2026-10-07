import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AddonImportNewRequestDto,
  AddonImportNewResultDto,
  AddonImportResultDto,
  AddonWho,
  WowForeverRuleset,
} from '@raid-ledger/contract';
import type { CharactersService } from '../../../characters/characters.service';
import {
  rethrowForeverViolation,
  WOW_FOREVER_GAME_SLUG,
} from '../wow-forever-identity.helpers';
import { ADDON_GUID_LOCK_CLASS } from './addon-import-binding.apply';
import {
  assertCreatable,
  createDtoFromExport,
  targetDto,
} from './addon-import-create.helpers';
import { titleCaseClass } from './addon-import.binding-name';
import type { DecodedAddonPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import type { AddonImportTx } from './addon-import-apply.types';
import {
  bindPaste,
  loadImportCharacter,
  runForCharacter,
  type LoadedCharacter,
} from './addon-import.run';
import {
  resolveImportTarget,
  type ImportTarget,
  type ImportTargetQuery,
} from './addon-import.target';

/**
 * ROK-1738 — the create route's preview (D11) and apply (D4) on top of the
 * per-character run. Apply is ONE transaction: GUID advisory lock FIRST,
 * re-resolve under it, every reject a pre-check before any write, nothing
 * caught-and-retried inside (postgres.js poisons the tx). A lost race on the
 * cross-player name index aborts the tx and maps to `CHARACTER_CLAIMED`
 * only AFTER rollback.
 */

/** Everything the create route knows about a paste once decoded. */
export interface CreateImportInput {
  userId: number;
  paste: DecodedAddonPaste;
  request: AddonImportNewRequestDto;
  /** The AUTHORITATIVE section's `who` (ruling Q7). */
  who: AddonWho;
  query: ImportTargetQuery;
}

type Creator = Pick<CharactersService, 'createWithin'>;

/** D11 — a create preview binds against this; no snapshot row matches. */
export const NIL_CHARACTER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * D11 — the would-be row a create preview binds against: built from the
 * export itself, so the binding finds nothing to diff or warn about.
 */
export function previewCharacter(input: CreateImportInput): LoadedCharacter {
  const { who, query } = input;
  assertCreatable(who);
  return {
    id: NIL_CHARACTER_ID,
    gameId: query.gameId,
    binding: {
      gameSlug: WOW_FOREVER_GAME_SLUG,
      name: query.name,
      region: query.region,
      ruleset: who.ruleset,
      class: titleCaseClass(who.class),
      level: who.level,
      addonGuid: who.guid,
    },
  };
}

/** Bind every section against `character`, then preview/apply on `tx`. */
function runBound(
  tx: AddonImportTx,
  input: CreateImportInput,
  character: LoadedCharacter,
): Promise<AddonImportResultDto> {
  const binding = bindPaste(input.paste, character, input.request);
  return runForCharacter(
    tx,
    input.userId,
    character,
    input.paste,
    binding,
    input.request,
  );
}

/** Dry run: read-only resolve (no lock), nothing created (D11, D13 i). */
export async function previewImport(
  db: AddonImportTx,
  input: CreateImportInput,
): Promise<AddonImportNewResultDto> {
  const target = await resolveImportTarget(db, input.query);
  const character =
    target.action === 'update' ? target.character : previewCharacter(input);
  const result = await db.transaction((tx) => runBound(tx, input, character));
  return {
    ...result,
    target: targetDto(target, input.who, input.query.region),
  };
}

/** Same class + key as `assertGuidFree`: serialises both routes. */
async function lockGuid(tx: AddonImportTx, q: ImportTargetQuery) {
  const key = `${q.gameId}:${q.region}:${q.guid}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ADDON_GUID_LOCK_CLASS}::int4, hashtext(${key}))`,
  );
}

/** Tracks whether a thrown error came out of the core create step. */
interface ApplyPhase {
  creating: boolean;
}

/** `create` target: core create → bind the inserted row → run (D4, D13). */
async function runCreate(
  tx: AddonImportTx,
  creator: Creator,
  input: CreateImportInput,
  target: ImportTarget,
  phase: ApplyPhase,
): Promise<AddonImportNewResultDto> {
  const { who, query, request } = input;
  // A1 + D13 pre-checks (RULESET_REQUIRED) — before any write.
  const dto = createDtoFromExport(
    who,
    query.region,
    query.gameId,
    request.ruleset,
  );
  phase.creating = true;
  const created = await creator.createWithin(tx, input.userId, dto);
  phase.creating = false;
  const character = await loadImportCharacter(tx, created.id);
  const result = await runBound(tx, input, character);
  const ruleset = character.binding.ruleset as WowForeverRuleset;
  return {
    ...result,
    target: targetDto(target, who, query.region, { id: created.id, ruleset }),
  };
}

/**
 * Apply: ONE tx, GUID lock first, re-resolve under it (D4). A claim
 * collision in the create step is mapped only AFTER rollback, then retried
 * ONCE in a fresh tx: if the colliding row is the caller's own (a manual
 * create in another tab landed between the re-resolve and the insert), the
 * re-resolve now finds it and the import becomes an update; another
 * player's row makes the resolver itself answer `CHARACTER_CLAIMED`.
 */
export async function applyImport(
  db: AddonImportTx,
  creator: Creator,
  input: CreateImportInput,
  retried = false,
): Promise<AddonImportNewResultDto> {
  const phase: ApplyPhase = { creating: false };
  try {
    return await db.transaction(async (tx) => {
      await lockGuid(tx, input.query);
      const target = await resolveImportTarget(tx, input.query);
      if (target.action === 'create') {
        return runCreate(tx, creator, input, target, phase);
      }
      const result = await runBound(tx, input, target.character);
      const dto = targetDto(target, input.who, input.query.region);
      return { ...result, target: dto };
    });
  } catch (err) {
    if (!phase.creating) throw err;
    const mapped = claimedOr(err, input.query);
    if (isClaimed(mapped) && !retried) {
      return applyImport(db, creator, input, true);
    }
    throw mapped;
  }
}

function isClaimed(err: unknown): boolean {
  return err instanceof AddonImportError && err.code === 'CHARACTER_CLAIMED';
}

/**
 * After rollback: a 409 from core's claim pre-check, or a raw violation of
 * the cross-player identity index (a lost race), → `CHARACTER_CLAIMED`.
 * Anything else is rethrown unchanged.
 */
export function claimedOr(err: unknown, q: ImportTargetQuery): unknown {
  if (err instanceof ConflictException) {
    return new AddonImportError('CHARACTER_CLAIMED');
  }
  try {
    rethrowForeverViolation(err, q.name, q.region);
  } catch (mapped) {
    if (mapped instanceof ConflictException) {
      return new AddonImportError('CHARACTER_CLAIMED');
    }
  }
  return err;
}

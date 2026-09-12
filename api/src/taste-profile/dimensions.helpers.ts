import type {
  TasteProfileDimensionsDto,
  TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import { TASTE_PROFILE_AXIS_POOL } from '@raid-ledger/contract';

/**
 * Read-path normaliser for the `dimensions` jsonb (ROK-1102 item 5, D8).
 *
 * Stored rows are only ever as wide as the axis pool was when the pipeline
 * last wrote them. When an axis is appended to `TASTE_PROFILE_AXIS_POOL`,
 * every row written before the forced backfill (see `SIGNAL_HASH_VERSION` in
 * `signal-hash.helpers.ts`) is one key short of what the contract requires —
 * and the web client parses those payloads with `TasteProfileDimensionsSchema`
 * (`web/src/lib/api/games-api.ts`), so a missing key is a thrown ZodError in
 * the browser for the whole deploy→backfill window.
 *
 * Projecting through the pool makes that window harmless: missing or
 * non-numeric axes read as `0`, retired axes are dropped, and the result is
 * always exactly pool-shaped. Generic by construction — no future pool
 * addition needs to touch this.
 */
export function normalizeDimensions(raw: unknown): TasteProfileDimensionsDto {
  const stored = (raw ?? {}) as Partial<Record<TasteProfilePoolAxis, unknown>>;
  const dims = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    const value = stored[axis];
    dims[axis] =
      typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return dims;
}

/**
 * ROK-1743: pure mapper from the LedgerLink `char` snapshot's `lockouts[]`
 * to the displayed `CharacterLockoutsDto`. No I/O — the service loads the
 * snapshot and passes the clock in.
 */
import type {
  AddonLockout,
  CharacterLockoutDto,
  CharacterLockoutsDto,
} from '@raid-ledger/contract';
import type { ForeverCharSnapshot } from './forever-char-snapshot.query';

/**
 * Standard WoW `difficultyId` labels (D4). WoW: Forever's ids are verified
 * only for 9 (40-player raids); the rest are the stock client values. An
 * unmapped id yields `null` so the web shows no label instead of a number.
 */
export const DIFFICULTY_LABELS: Readonly<Record<number, string>> = {
  1: 'Normal',
  2: 'Heroic',
  3: '10 Player',
  4: '25 Player',
  5: '10 Player (Heroic)',
  6: '25 Player (Heroic)',
  9: '40 Player',
  148: '20 Player',
  173: 'Normal',
  174: 'Heroic',
  175: '10 Player',
  176: '25 Player',
};

/** The label for a WoW difficulty id, or null when it is not mapped. */
export function difficultyLabel(id: number): string | null {
  return DIFFICULTY_LABELS[id] ?? null;
}

function toLockout(raw: AddonLockout): CharacterLockoutDto {
  return {
    name: raw.name,
    instanceId: raw.instanceId,
    difficultyId: raw.difficultyId,
    difficulty: difficultyLabel(raw.difficultyId),
    resetAt: new Date(raw.resetAt * 1000).toISOString(),
    killed: raw.killed,
    total: raw.total,
  };
}

/** Soonest reset first, then name (D5). */
function byResetThenName(a: AddonLockout, b: AddonLockout): number {
  return a.resetAt - b.resetAt || a.name.localeCompare(b.name);
}

/**
 * The snapshot's unexpired lockouts, or undefined when none remain (D3) —
 * `undefined` keeps the `lockouts` key off the character DTO.
 */
export function snapshotToLockouts(
  snapshot: ForeverCharSnapshot,
  nowMs: number,
): CharacterLockoutsDto | undefined {
  const raw: unknown = snapshot.data.lockouts;
  if (!Array.isArray(raw)) return undefined;
  const live = snapshot.data.lockouts
    .filter((l) => l.resetAt * 1000 > nowMs)
    .sort(byResetThenName);
  if (live.length === 0) return undefined;
  return {
    source: 'addon',
    syncedAt: snapshot.capturedAt.toISOString(),
    instances: live.map(toLockout),
  };
}

/**
 * ROK-1926 — lockout ↔ event raid matching for the "saved" check.
 *
 * The addon's `lockouts[].instanceId` is the in-game id, which may not be the
 * event's journal / seed id (UNVERIFIED — spec Q6, journal alias map empty),
 * so a save matches a raid by id OR by its normalised name / short name
 * (rec 6). A save that matches nothing never fails a row.
 */
import type { AddonLockout } from '@raid-ledger/contract';

/** One parsed entry of `events.content_instances`. */
export interface ReadinessInstance {
  id: number | null;
  name: string;
  shortName: string | null;
  minimumLevel: number | null;
  category: 'dungeon' | 'raid' | null;
}

/** Lower-case, letters and digits only ("The Barrow-Deeps" → "thebarrowdeeps"). */
export function normaliseInstanceName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** True when the save is for this event raid (by id or by name). */
export function lockoutMatchesInstance(
  lockout: Pick<AddonLockout, 'instanceId' | 'name'>,
  instance: ReadinessInstance,
): boolean {
  if (instance.id !== null && lockout.instanceId === instance.id) return true;
  const saved = normaliseInstanceName(lockout.name);
  if (saved === '') return false;
  const names = [instance.name, instance.shortName]
    .filter((n): n is string => n !== null)
    .map(normaliseInstanceName);
  return names.includes(saved);
}

export interface BlockingSave {
  lockout: AddonLockout;
  instance: ReadinessInstance;
}

/**
 * The first save to one of `raids` still locked when the event starts
 * (rec 7: `resetAt*1000 > startMs`; a save resetting at or before the start
 * is free). Null = no blocking save.
 */
export function findBlockingSave(
  lockouts: readonly AddonLockout[],
  raids: readonly ReadinessInstance[],
  startMs: number,
): BlockingSave | null {
  for (const lockout of lockouts) {
    if (lockout.resetAt * 1000 <= startMs) continue;
    const instance = raids.find((r) => lockoutMatchesInstance(lockout, r));
    if (instance) return { lockout, instance };
  }
  return null;
}

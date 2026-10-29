/**
 * ROK-1910 — the per-field fact precedence rule (plan ROK-1905 §2.3). Pure:
 * no I/O, no clock reads (the caller passes `now`).
 *
 * 1. A `manual` value wins for the fields a user can edit (roleOverride,
 *    professions).
 * 2. Otherwise, only while the REGISTERED Blizzard seam is live
 *    (`blizzardFresh`), a `blizzard` value fresher than {@link FRESH_WINDOW_MS}
 *    wins. With the seam off, blizzard-labelled facts (e.g. an Armory-synced
 *    `characters` row) compete on newest `asOf` only — a stale-in-reality row
 *    stamped at sync time must not beat a newer addon snapshot.
 * 3. Otherwise the newest `asOf` among addon, roster and blizzard wins (an
 *    unknown `asOf` sorts last). A `manual` value of a non-editable field is
 *    only the fallback after that.
 * 4. Otherwise the fact is unknown (`null`).
 */
import {
  type Fact,
  type ResolvedWowFacts,
  type WowFactCandidates,
  type WowFactField,
  type WowFactValues,
} from './wow-fact.types';

/** How long a Blizzard value outranks a newer addon/roster value. */
export const FRESH_WINDOW_MS = 24 * 3600 * 1000;

/** One row of the precedence table. */
export interface FieldPrecedence {
  /** A user-entered (`manual`) value wins outright. */
  manualOverride: boolean;
  /** Blizzard may answer this field at all. */
  blizzardAllowed: boolean;
}

const DEFAULT_ROW: FieldPrecedence = {
  manualOverride: false,
  blizzardAllowed: true,
};

/**
 * The per-field table. Professions never come from Blizzard: the classic
 * Profile API has no professions endpoint (`blizzard-professions.helpers.ts`).
 */
export const FIELD_PRECEDENCE: Readonly<Record<WowFactField, FieldPrecedence>> =
  {
    level: DEFAULT_ROW,
    class: DEFAULT_ROW,
    race: DEFAULT_ROW,
    role: { manualOverride: true, blizzardAllowed: true },
    ilvl: DEFAULT_ROW,
    gear: DEFAULT_ROW,
    professions: { manualOverride: true, blizzardAllowed: false },
    quests: DEFAULT_ROW,
    lockouts: DEFAULT_ROW,
    lastOnline: DEFAULT_ROW,
    enchantsReported: DEFAULT_ROW,
  };

const time = (f: Fact<unknown>): number => f.asOf?.getTime() ?? -Infinity;

/** The newest candidate; ties keep the earlier one. */
function newest<T>(facts: Fact<T>[]): Fact<T> | null {
  let best: Fact<T> | null = null;
  for (const f of facts) if (!best || time(f) > time(best)) best = f;
  return best;
}

/** Is this blizzard value inside the fresh window? */
function isFresh(f: Fact<unknown>, now: Date): boolean {
  return f.asOf !== null && now.getTime() - f.asOf.getTime() <= FRESH_WINDOW_MS;
}

/**
 * Pick the winning fact for one field.
 * @param blizzardFresh the registered Blizzard seam is live; enables rule 2.
 * @returns the winner, or null when no source knows the field.
 */
export function resolveField<T>(
  field: WowFactField,
  candidates: Fact<T>[],
  now: Date,
  blizzardFresh: boolean,
): Fact<T> | null {
  const rule = FIELD_PRECEDENCE[field];
  const allowed = candidates.filter(
    (c) => rule.blizzardAllowed || c.source !== 'blizzard',
  );
  const manual = allowed.filter((c) => c.source === 'manual');
  const others = allowed.filter((c) => c.source !== 'manual');
  if (rule.manualOverride && manual.length > 0) return newest(manual);
  const fresh = blizzardFresh
    ? others.filter((c) => c.source === 'blizzard' && isFresh(c, now))
    : [];
  if (fresh.length > 0) return newest(fresh);
  return newest(others) ?? newest(manual);
}

/** Resolve one field across every source's candidates. */
function resolveOne<F extends WowFactField>(
  field: F,
  perSource: WowFactCandidates[],
  now: Date,
  blizzardFresh: boolean,
): Fact<WowFactValues[F]> | null {
  const candidates: Fact<WowFactValues[F]>[] = [];
  for (const c of perSource) {
    const f = c[field];
    if (f) candidates.push(f);
  }
  return resolveField(field, candidates, now, blizzardFresh);
}

/**
 * Resolve every field of one roster row.
 * @param perSource what each source knows about the row.
 * @param blizzardFresh the registered Blizzard seam is live (see rule 2).
 */
export function resolveFacts(
  perSource: WowFactCandidates[],
  now: Date,
  blizzardFresh: boolean,
): ResolvedWowFacts {
  const r = <F extends WowFactField>(f: F): Fact<WowFactValues[F]> | null =>
    resolveOne(f, perSource, now, blizzardFresh);
  return {
    level: r('level'),
    class: r('class'),
    race: r('race'),
    role: r('role'),
    ilvl: r('ilvl'),
    gear: r('gear'),
    professions: r('professions'),
    quests: r('quests'),
    lockouts: r('lockouts'),
    lastOnline: r('lastOnline'),
    enchantsReported: r('enchantsReported'),
  };
}

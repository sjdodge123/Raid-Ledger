/**
 * ROK-1910 — the per-field fact precedence rule (plan ROK-1905 §2.3). Pure:
 * no I/O, no clock reads.
 *
 * 1. A `manual` value wins for the fields a user can edit (roleOverride; and
 *    professions only if `MANUAL_PROFESSIONS_WIN` is flipped back on — the
 *    ROK-2107 ruling F0 of 2026-11-07 has Blizzard win, manual as fallback).
 * 2. Otherwise any `blizzard` value wins, REGARDLESS OF AGE (ROK-2138 ruling
 *    2026-11-08: the official Blizzard API is the primary source; LedgerLink
 *    only fills gaps). The newest of several blizzard values wins. This holds
 *    whether or not the Blizzard seam is live (OQ-1): a stored Armory value
 *    is still Blizzard data when the kill switch stops new calls.
 * 3. Otherwise the newest `asOf` among addon and roster wins (an unknown
 *    `asOf` sorts last) — the gap-fill. A `manual` value of a non-editable
 *    field is only the fallback after that.
 * 4. Otherwise the fact is unknown (`null`).
 *
 * "Has a value" is the source's job: a fact source emits no blizzard
 * candidate for an empty Blizzard value (e.g. zero equipped items, E1).
 */
import { MANUAL_PROFESSIONS_WIN } from '../../../characters/characters-professions.helpers';
import {
  type Fact,
  type ResolvedWowFacts,
  type WowFactCandidates,
  type WowFactField,
  type WowFactValues,
} from './wow-fact.types';

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
 * The per-field table. Professions come from Blizzard too (ROK-2107): the
 * Armory sync writes `characters.armory_professions` (retail + Forever serve a
 * `/professions` endpoint). Whether a hand entry beats it is the ONE switch
 * `MANUAL_PROFESSIONS_WIN`, shared with the character DTO so they never disagree.
 */
export const FIELD_PRECEDENCE: Readonly<Record<WowFactField, FieldPrecedence>> =
  {
    level: DEFAULT_ROW,
    class: DEFAULT_ROW,
    race: DEFAULT_ROW,
    role: { manualOverride: true, blizzardAllowed: true },
    ilvl: DEFAULT_ROW,
    gear: DEFAULT_ROW,
    professions: {
      manualOverride: MANUAL_PROFESSIONS_WIN,
      blizzardAllowed: true,
    },
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

/**
 * Pick the winning fact for one field.
 * @returns the winner, or null when no source knows the field.
 */
export function resolveField<T>(
  field: WowFactField,
  candidates: Fact<T>[],
): Fact<T> | null {
  const rule = FIELD_PRECEDENCE[field];
  const allowed = candidates.filter(
    (c) => rule.blizzardAllowed || c.source !== 'blizzard',
  );
  const manual = allowed.filter((c) => c.source === 'manual');
  const others = allowed.filter((c) => c.source !== 'manual');
  if (rule.manualOverride && manual.length > 0) return newest(manual);
  const blizzard = others.filter((c) => c.source === 'blizzard');
  if (blizzard.length > 0) return newest(blizzard);
  return newest(others) ?? newest(manual);
}

/** Resolve one field across every source's candidates. */
function resolveOne<F extends WowFactField>(
  field: F,
  perSource: WowFactCandidates[],
): Fact<WowFactValues[F]> | null {
  const candidates: Fact<WowFactValues[F]>[] = [];
  for (const c of perSource) {
    const f = c[field];
    if (f) candidates.push(f);
  }
  return resolveField(field, candidates);
}

/**
 * Resolve every field of one roster row.
 * @param perSource what each source knows about the row.
 */
export function resolveFacts(perSource: WowFactCandidates[]): ResolvedWowFacts {
  const r = <F extends WowFactField>(f: F): Fact<WowFactValues[F]> | null =>
    resolveOne(f, perSource);
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

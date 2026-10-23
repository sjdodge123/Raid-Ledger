/**
 * ROK-1933 L1 — pure matcher for the suggested-claim DM (spec Part 3).
 * Given one unclaimed character seen on a server and the plausible owners,
 * pick at most ONE user to ask. A wrong DM is worse than none (D7), so any
 * tie returns null. The operator has not ruled on the rule yet (Q4): it lives
 * in `pickClaimCandidate` and the two constants below, nowhere else.
 */

/** How well a candidate's name matches the character's. */
export type NameStrength = 'strong' | 'medium' | 'none';

/** The unclaimed character a suggestion would be about. */
export interface ClaimSubject {
  profileId: number;
  /** The in-game character name. */
  characterName: string;
  /** The SteamID64 the mod asserted for the character. */
  steamId: string;
}

/** A plausible owner, as the candidate query returns them. */
export interface ClaimCandidate {
  userId: number;
  /** Every name the user goes by (RL username, display name, voice name). */
  names: string[];
  /** In the same live Quick Play's voice channel right now. */
  inVoice: boolean;
  /** The user's Raid-Ledger-verified SteamID64, if linked. */
  steamId: string | null;
}

/** Shortest normalised name a fuzzy (medium) match may use. */
const MIN_FUZZY_LENGTH = 4;
/** Containment counts only when the shorter name covers ≥ 70% of the longer. */
const CONTAINMENT_RATIO = 0.7;

/**
 * Fold a display name for comparison: NFKD splits "ö" into "o" + a combining
 * mark, then everything not a letter or digit goes (the marks, decorative
 * symbols, spaces, `_`), then lowercase. "Brannök" → "brannok", "M✿rrow" → "mrrow".
 */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/** True when `a` becomes `b` with at most one insert, delete or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i += 1;
  const tailS = s.length === l.length ? s.slice(i + 1) : s.slice(i);
  return tailS === l.slice(i + 1);
}

/** One name contains the other and covers most of it (no short-prefix traps). */
function containsMost(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return l.includes(s) && s.length >= l.length * CONTAINMENT_RATIO;
}

/**
 * Exact after normalisation = strong; one edit apart or near-full containment
 * (both ≥ 4 chars) = medium; anything else, or an empty fold, = none.
 */
export function nameStrength(character: string, candidate: string): NameStrength {
  const a = normaliseName(character);
  const b = normaliseName(candidate);
  if (a === '' || b === '') return 'none';
  if (a === b) return 'strong';
  if (Math.min(a.length, b.length) < MIN_FUZZY_LENGTH) return 'none';
  return withinOneEdit(a, b) || containsMost(a, b) ? 'medium' : 'none';
}

const RANK: Record<NameStrength, number> = { none: 0, medium: 1, strong: 2 };

/** The best strength across every name the candidate goes by. */
function bestStrength(subject: ClaimSubject, c: ClaimCandidate): number {
  return Math.max(0, ...c.names.map((n) => RANK[nameStrength(subject.characterName, n)]));
}

/** The only element of `xs`, or null when there are none or several. */
function only<T>(xs: T[]): T | null {
  return xs.length === 1 ? (xs[0] ?? null) : null;
}

/**
 * The spec's default rule (Q4, D6, D7): drop users whose verified Steam
 * differs from the character's; then the single best name match (≥ medium,
 * a tie at the top → null); with no name match, the lone candidate in voice.
 * Returns the user id to DM, or null for no DM.
 */
export function pickClaimCandidate(
  subject: ClaimSubject,
  candidates: readonly ClaimCandidate[],
): number | null {
  const eligible = candidates.filter(
    (c) => c.steamId === null || c.steamId === subject.steamId,
  );
  const scored = eligible.map((c) => ({ c, rank: bestStrength(subject, c) }));
  const top = Math.max(0, ...scored.map((s) => s.rank));
  if (top > 0) {
    return only(scored.filter((s) => s.rank === top))?.c.userId ?? null;
  }
  return only(eligible.filter((c) => c.inVoice))?.userId ?? null;
}

/**
 * Pure helper that maps phase-level action state + viewer submission state
 * to the SubmitBar's visual `kind` (ROK-1296, U4 SubmitBar).
 *
 * Decision table (from spec ROK-1296 §UI States):
 *   submittedAt != null                              → 'post'
 *   submittedAt == null && !hasAnyAction             → 'empty'
 *   submittedAt == null && hasAnyAction && !full     → 'partial'
 *   submittedAt == null && hasFullAction             → 'pre'
 *
 * `submittedAt` always wins. Composites decide whether to render a "Change
 * my X" affordance for the post state — the SubmitBar itself is purely
 * props-driven.
 */
export type SubmitKind = 'empty' | 'partial' | 'pre' | 'post';

/** Input to {@link deriveSubmitKind}. */
export interface DeriveSubmitKindInput {
  /** Server-stamped submit timestamp (ISO 8601) or null. */
  submittedAt: string | null;
  /** True when the viewer has taken at least one autosave action. */
  hasAnyAction: boolean;
  /** True when the viewer has used their full allotment (cleanest pre). */
  hasFullAction: boolean;
}

/**
 * Map submit + action state to one of the 4 visual kinds.
 *
 * Defensive: empty-string `submittedAt` and `undefined` both fall through
 * to the unsubmitted branch. `hasFullAction` implies any-action; if a
 * caller passes the inconsistent combination, `hasFullAction` wins.
 */
export function deriveSubmitKind(input: DeriveSubmitKindInput): SubmitKind {
  const { submittedAt, hasAnyAction, hasFullAction } = input;
  if (submittedAt != null && submittedAt !== '') return 'post';
  if (hasFullAction) return 'pre';
  if (hasAnyAction) return 'partial';
  return 'empty';
}

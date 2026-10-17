/**
 * Shared label/disabled logic for the Common Ground "+ Nominate" button
 * (ROK-1349).
 *
 * Previously the disabled state conflated two distinct reasons:
 *   - `atCap` — the lineup has reached its NOMINATION cap.
 *   - `viewOnly` — the viewer cannot participate (a private-lineup
 *     non-invitee), so every card was mislabelled "Lineup full".
 *
 * Splitting them lets the button explain WHY it's disabled. `viewOnly`
 * takes precedence because it's a permission state, not a capacity state.
 */
export interface NominateButtonState {
  label: string;
  disabled: boolean;
}

/** Full copy for the view-only state; cards may truncate the label. */
export const VIEW_ONLY_LABEL = 'View only — ask the creator for an invite';
/** Compact label for narrow card buttons (full text goes in the title). */
export const VIEW_ONLY_LABEL_SHORT = 'View only';
/** Copy for a genuine nomination-cap-reached state. */
export const NOMINATION_CAP_LABEL = 'Nomination cap reached';

/**
 * Resolve the nominate button's label + disabled flag from the three
 * inputs that gate it. `viewOnly` wins over `atCap` (a permission block
 * is more informative than a capacity block); `isNominating` overrides
 * the label with the in-flight "Adding…" copy but keeps the button
 * disabled either way.
 */
export function nominateButtonState(
  atCap: boolean,
  viewOnly: boolean,
  isNominating: boolean,
  opts: { compact?: boolean; addingLabel?: string; nominateLabel?: string } = {},
): NominateButtonState {
  const disabled = isNominating || atCap || viewOnly;
  if (isNominating) {
    return { label: opts.addingLabel ?? 'Adding…', disabled };
  }
  if (viewOnly) {
    return {
      label: opts.compact ? VIEW_ONLY_LABEL_SHORT : VIEW_ONLY_LABEL,
      disabled,
    };
  }
  if (atCap) return { label: NOMINATION_CAP_LABEL, disabled };
  return { label: opts.nominateLabel ?? '+ Nominate', disabled };
}

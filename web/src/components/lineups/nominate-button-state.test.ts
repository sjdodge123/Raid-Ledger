/**
 * Unit tests for nominateButtonState (ROK-1349).
 *
 * Locks the disabled-reason matrix that the bug conflated: a genuine
 * nomination cap, a view-only (non-invitee) viewer, and the in-flight
 * nominating state must each produce a distinct label, with `viewOnly`
 * taking precedence over `atCap`.
 */
import { describe, expect, it } from 'vitest';
import {
  nominateButtonState,
  NOMINATION_CAP_LABEL,
  VIEW_ONLY_LABEL,
  VIEW_ONLY_LABEL_SHORT,
} from './nominate-button-state';

describe('nominateButtonState', () => {
  it('is nominatable (enabled, "+ Nominate") when neither cap nor view-only', () => {
    expect(nominateButtonState(false, false, false)).toEqual({
      label: '+ Nominate',
      disabled: false,
    });
  });

  it('shows the cap label and disables when atCap (and not view-only)', () => {
    expect(nominateButtonState(true, false, false)).toEqual({
      label: NOMINATION_CAP_LABEL,
      disabled: true,
    });
  });

  it('shows the full view-only label and disables when viewOnly', () => {
    expect(nominateButtonState(false, true, false)).toEqual({
      label: VIEW_ONLY_LABEL,
      disabled: true,
    });
  });

  it('uses the compact view-only label when compact is set', () => {
    expect(nominateButtonState(false, true, false, { compact: true })).toEqual({
      label: VIEW_ONLY_LABEL_SHORT,
      disabled: true,
    });
  });

  it('prefers the view-only label over the cap label when both are true', () => {
    const { label } = nominateButtonState(true, true, false);
    expect(label).toBe(VIEW_ONLY_LABEL);
  });

  it('shows the adding label (disabled) while nominating, regardless of cap/view', () => {
    expect(nominateButtonState(false, false, true)).toEqual({
      label: 'Adding…',
      disabled: true,
    });
    expect(nominateButtonState(true, true, true).label).toBe('Adding…');
  });

  it('honours custom labels', () => {
    expect(
      nominateButtonState(false, false, false, { nominateLabel: 'Nominate' })
        .label,
    ).toBe('Nominate');
    expect(
      nominateButtonState(false, false, true, { addingLabel: 'Nominating…' })
        .label,
    ).toBe('Nominating…');
  });
});

/**
 * ROK-1710 — the nomination target block of the Edit Lineup modal.
 *
 * Reuses the create modal's `NominationTargetControl` (Checkbox + Slider), so
 * editing a target looks exactly like setting one. Rendered only while the
 * lineup is still nominating: the API refuses a target change in any other
 * status (409).
 *
 * A lineup an operator reverted from voting is "disarmed" — it will not open
 * voting early on its own. The hint says so, and that saving a target turns
 * early advance back on (the explicit edit is the re-arm).
 */
import { useId, type JSX } from 'react';
import { NominationTargetControl } from './start-lineup-nomination-target';

/** The target as the modal opens it. Absent = the lineup is not nominating. */
export interface EditableTarget {
    initialPct: number | null;
    disarmed: boolean;
}

export const DISARMED_TARGET_HINT =
    'Early advance is off — this lineup was reverted. Saving a target turns it back on.';

export function EditTargetSection({ disarmed, value, onChange }: {
    disarmed: boolean;
    value: number | null;
    onChange: (next: number | null) => void;
}): JSX.Element {
    // The hint is tied to the toggle, so a screen reader announces it there.
    const hintId = useId();
    return (
        <div className="space-y-2" data-testid="edit-lineup-target-section">
            {disarmed && (
                <p id={hintId} className="text-xs text-muted" data-testid="edit-lineup-target-disarmed">
                    {DISARMED_TARGET_HINT}
                </p>
            )}
            <NominationTargetControl
                value={value}
                onChange={onChange}
                describedBy={disarmed ? hintId : undefined}
            />
        </div>
    );
}

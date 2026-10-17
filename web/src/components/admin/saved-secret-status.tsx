/**
 * The saved-state row under a write-only secret input (ROK-1591, design
 * system §4.11 "Write-only secrets with a saved state"). The input itself is
 * never prefilled; this row says whether a secret is stored and lets the admin
 * queue its removal, which only happens when the form is saved.
 *
 * Rendered on `/dev/design-system` → Forms (`forms-section.tsx`).
 */
import { Button } from '../ui/button';

export interface SavedSecretStatusProps {
    /** What the secret is, e.g. "Google client secret" — names the Remove button. */
    secretLabel: string;
    /** A secret is stored server-side. */
    hasSecret: boolean;
    /** The admin pressed Remove and has not saved yet. */
    cleared: boolean;
    onClearedChange: (cleared: boolean) => void;
    /** `data-testid` for the Saved chip. */
    testId?: string;
}

/** "No secret saved yet" / a `Saved` chip + Remove / a pending-removal line + Undo. */
export function SavedSecretStatus({ secretLabel, hasSecret, cleared, onClearedChange, testId }: SavedSecretStatusProps) {
    if (!hasSecret) return <p className="text-xs text-muted">No secret saved yet.</p>;
    if (cleared) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-warning">The saved secret will be removed when you save.</p>
                <Button variant="ghost" size="sm" onClick={() => onClearedChange(false)}>Undo</Button>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span data-testid={testId}
                className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                Saved
            </span>
            <Button variant="ghost" size="sm" onClick={() => onClearedChange(true)} aria-label={`Remove saved ${secretLabel}`}>
                Remove saved secret
            </Button>
        </div>
    );
}

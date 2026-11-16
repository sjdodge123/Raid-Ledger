/**
 * ROK-2215 — the plan's "Will invite" line above the Create Event footer. A
 * neutral core line in the `InheritedHubLine` pattern (tokens only); the names
 * come in as props, resolved by the page. "Don't invite" clears the plan.
 */
import type { JSX } from 'react';
import { Button } from '../ui/button';
import { invitePreviewText } from '../../pages/create-event-prefill';

interface InvitePreviewLineProps {
    /** Character names the roster resolved, in plan order. */
    names: string[];
    /** Planned characters with no resolved name. */
    unresolved: number;
    /** Drops the invites (the event is still created). */
    onRemove: () => void;
}

/** "Will invite: Aelin, Brann" with a "Don't invite" action. */
export function InvitePreviewLine({ names, unresolved, onRemove }: InvitePreviewLineProps): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-surface px-3 py-2" data-testid="invite-preview-line">
            <p className="text-sm text-secondary">
                <span className="font-medium text-foreground">{invitePreviewText(names, unresolved)}</span>
                <span className="block text-xs text-muted">Each player gets an invite DM once the event is created; anyone without a linked Discord account is skipped.</span>
            </p>
            <Button variant="secondary" size="sm" onClick={onRemove}>Don&apos;t invite</Button>
        </div>
    );
}

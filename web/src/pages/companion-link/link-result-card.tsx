/** ROK-1955 — `/link` terminal states: approved / denied. */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/ui/button-classes';
import { LinkCard } from './link-card';
import { MANAGE_DEVICES_HREF } from './link-copy';

/** Success banner + "Manage devices", or the neutral denied note. */
export function LinkResultCard({ status }: { status: 'approved' | 'denied' }): JSX.Element {
    if (status === 'denied') {
        return (
            <LinkCard>
                <p role="status" className="rounded-lg border border-edge bg-overlay/30 p-3 text-sm text-secondary">
                    Denied — that computer will not be linked.
                </p>
            </LinkCard>
        );
    }
    return (
        <LinkCard>
            <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                <strong>Approved.</strong> Return to your computer — it finishes linking in a few seconds.
            </p>
            <div className="mt-4 flex gap-2">
                <Link to={MANAGE_DEVICES_HREF} className={buttonClass({ variant: 'ghost', size: 'sm' })}>Manage devices</Link>
            </div>
        </LinkCard>
    );
}

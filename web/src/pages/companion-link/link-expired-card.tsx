/** ROK-1955 — the code's 10-minute lifetime ran out while the page was open. */
import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { LinkCard } from './link-card';

/** Expired state: no Approve; offer a fresh code entry. */
export function LinkExpiredCard({ onRestart }: { onRestart: () => void }): JSX.Element {
    return (
        <LinkCard title="Link a computer">
            <p role="alert" className="mt-2 text-sm text-danger">That code has expired. Start again on your computer.</p>
            <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={onRestart}>Enter a new code</Button>
            </div>
        </LinkCard>
    );
}

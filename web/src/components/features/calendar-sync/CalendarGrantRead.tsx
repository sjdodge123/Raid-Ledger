/**
 * "Grant read access" (ROK-1595 spec §4): re-runs the Google consent with the
 * read scopes. The read-rules section shows it when no account can read; a
 * connection card shows it for its own account when another account already
 * reads (the section then carries the mode controls instead).
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { useStartOAuth, type OAuthCalendarProvider } from '../../../hooks/use-calendar-sync';
import { READ_COPY as R } from './calendar-sync.copy';

/** `provider`: whose consent to re-run — the card passes its own (Outlook, ROK-1597); the section defaults to Google. */
export function GrantRead({ provider = 'google' }: { provider?: OAuthCalendarProvider }): JSX.Element {
    const grant = useStartOAuth('read', undefined, provider);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3" data-testid="calendar-read-grant">
            <p className="text-sm text-secondary">{R.grantTitle}</p>
            <Button variant="secondary" loading={grant.isPending} loadingLabel={R.granting} onClick={() => grant.mutate()}
                data-testid="calendar-read-grant-button">
                {R.grant}
            </Button>
            {grant.isError && <p role="alert" className="w-full text-sm text-danger">{R.fixFailed}</p>}
        </div>
    );
}

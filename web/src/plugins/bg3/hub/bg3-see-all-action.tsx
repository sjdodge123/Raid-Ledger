/** ROK-1958 D-3 / D-9 — BG3 header actions: links to the Campaign tab (`#campaign`). */
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FOCUS_RING } from '../../../components/ui/form-classes';

function CampaignLink({ label, testId }: { label: string; testId: string }): JSX.Element {
    const { pathname, search } = useLocation();
    return (
        <Link to={{ pathname, search, hash: '#campaign' }} data-testid={testId}
            className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            {label}
        </Link>
    );
}

/** Session history → the Campaign tab's History section. */
export function Bg3SeeAllAction(): JSX.Element {
    return <CampaignLink label="Show all" testId="bg3-sessions-show-all" />;
}

/** Party → the Campaign tab (campaigns + binding). */
export function Bg3CampaignAction(): JSX.Element {
    return <CampaignLink label="Campaign ›" testId="bg3-party-campaign-link" />;
}

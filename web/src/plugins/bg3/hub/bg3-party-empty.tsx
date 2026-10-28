/**
 * ROK-1958 §3.1 / §4.5 — the Party card's empty and error states. The Party
 * card stays visible with no campaign or no saves (D-10, Q6): it carries the
 * binding entry point. One quiet sentence + the next step.
 */
import type { JSX, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { buttonClass } from '../../../components/ui/button-classes';

export type Bg3PartyEmptyKind = 'no-campaign' | 'no-saves' | 'no-active';

export interface Bg3PartyEmptyProps {
    readonly kind: Bg3PartyEmptyKind;
    /** The active campaign's name (`no-saves`). */
    readonly campaignName: string | null;
    /** Hub editor / staff — "Pick the active campaign." instead of "No active campaign." */
    readonly canEdit: boolean;
    readonly onStartCampaign: () => void;
    readonly onAddSaves: () => void;
}

function EmptyFrame({ text, children }: { text: string; children?: ReactNode }): JSX.Element {
    return (
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="bg3-party-empty">
            <p className="text-sm text-muted">{text}</p>
            {children}
        </div>
    );
}

function CampaignTabLink(): JSX.Element {
    const { pathname, search } = useLocation();
    return (
        <Link to={{ pathname, search, hash: '#campaign' }} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            Open Campaign
        </Link>
    );
}

export function Bg3PartyEmpty(props: Bg3PartyEmptyProps): JSX.Element {
    if (props.kind === 'no-campaign') {
        return (
            <EmptyFrame text="No campaign on this hub yet.">
                <Button variant="primary" size="sm" onClick={props.onStartCampaign}>Start a campaign</Button>
            </EmptyFrame>
        );
    }
    if (props.kind === 'no-saves') {
        return (
            <EmptyFrame text={`No saves in ${props.campaignName ?? 'this campaign'} yet.`}>
                <Button variant="secondary" size="sm" onClick={props.onAddSaves}>Add my saves</Button>
            </EmptyFrame>
        );
    }
    if (!props.canEdit) return <EmptyFrame text="No active campaign." />;
    return (
        <EmptyFrame text="Pick the active campaign.">
            <CampaignTabLink />
        </EmptyFrame>
    );
}

/** Non-403/404 query failure: a quiet line + retry (403/404 hide the card via `useVisible`). */
export function Bg3PartyError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
            <p className="text-sm text-muted">Couldn&apos;t load the party.</p>
            <Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
        </div>
    );
}

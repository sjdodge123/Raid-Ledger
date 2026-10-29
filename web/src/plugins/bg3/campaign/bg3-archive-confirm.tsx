/**
 * ROK-1958 D-11 / §4.4 — "Archive <name>?" confirm. Soft archive only
 * (operator Q5): history stays, it leaves the active switch. Unarchive is
 * immediate and needs no confirm.
 */
import type { JSX } from 'react';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useUpdateBg3Campaign } from '../hooks/use-bg3-mutations';
import { Bg3Overlay } from './bg3-overlay';
import { toastBg3CampaignError } from './bg3-campaign-toast';

export interface Bg3ArchiveConfirmProps {
    readonly hubId: number;
    /** The campaign to archive; null = closed. */
    readonly campaign: Bg3CampaignSummary | null;
    readonly onClose: () => void;
}

export function Bg3ArchiveConfirm({ hubId, campaign, onClose }: Bg3ArchiveConfirmProps): JSX.Element {
    const update = useUpdateBg3Campaign(hubId);
    const archive = (): void => {
        if (!campaign) return;
        update.mutate({ campaignId: campaign.id, body: { archived: true } }, {
            onSuccess: onClose,
            onError: (err) => toastBg3CampaignError(err, "Couldn't archive the campaign."),
        });
    };
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" onClick={archive} loading={update.isPending}>Archive</Button>
        </>
    );
    return (
        <Bg3Overlay isOpen={campaign !== null} title={`Archive ${campaign?.name ?? 'campaign'}?`} onClose={onClose} footer={footer}>
            <p className="text-sm text-secondary" data-testid="bg3-archive-confirm">
                Its history stays. It stops being the active campaign, and saves stop going to it by default. You can unarchive it later.
            </p>
        </Bg3Overlay>
    );
}

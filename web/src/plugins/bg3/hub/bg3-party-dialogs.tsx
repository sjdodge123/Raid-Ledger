/**
 * ROK-1958 D-4 / D-5 — the seam between the Party card's empty-state buttons
 * and the campaign UI (`../campaign/`): "Start a campaign" opens the start
 * dialog; "Add my saves" opens the add-saves sheet for the active campaign
 * (only rendered when there is one).
 */
import type { JSX } from 'react';
import { Bg3AddSavesSheet, Bg3StartCampaignDialog } from '../campaign';

export type Bg3PartyDialog = 'start' | 'add-saves' | null;

export interface Bg3PartyDialogsProps {
    readonly open: Bg3PartyDialog;
    readonly onClose: () => void;
    readonly hubId: number;
    /** The active campaign (add-saves target); null when there is none. */
    readonly campaignId: number | null;
    readonly campaignName: string | null;
}

export function Bg3PartyDialogs({ open, onClose, hubId, campaignId, campaignName }: Bg3PartyDialogsProps): JSX.Element {
    return (
        <>
            <Bg3StartCampaignDialog isOpen={open === 'start'} hubId={hubId} onClose={onClose} />
            {campaignId !== null && campaignName !== null && (
                <Bg3AddSavesSheet isOpen={open === 'add-saves'} hubId={hubId} campaignId={campaignId}
                    campaignName={campaignName} onClose={onClose} />
            )}
        </>
    );
}

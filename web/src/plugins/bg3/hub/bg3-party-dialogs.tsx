/**
 * ROK-1958 D-4 / D-5 — the seam between the Party card's empty-state buttons
 * and the campaign UI (`../campaign/`): "Start a campaign" opens the start
 * dialog; "Add my saves" opens the add-saves sheet for the active campaign
 * (only rendered when there is one); "Upload a save" opens the ROK-1960 upload sheet.
 */
import type { JSX } from 'react';
import { Bg3AddSavesSheet, Bg3StartCampaignDialog } from '../campaign';
import { Bg3UploadSaveSheet } from '../upload/bg3-upload-save-sheet';

export type Bg3PartyDialog = 'start' | 'add-saves' | 'upload' | null;

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
            {/* Mounted only while open: a closed BottomSheet stays in the DOM off-screen (see bg3-campaign-tab). */}
            {open === 'start' && <Bg3StartCampaignDialog isOpen hubId={hubId} onClose={onClose} />}
            {open === 'upload' && <Bg3UploadSaveSheet isOpen hubId={hubId} onClose={onClose} />}
            {open === 'add-saves' && campaignId !== null && campaignName !== null && (
                <Bg3AddSavesSheet isOpen hubId={hubId} campaignId={campaignId}
                    campaignName={campaignName} onClose={onClose} />
            )}
        </>
    );
}

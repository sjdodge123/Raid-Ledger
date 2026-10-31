/**
 * ROK-1960 §5 — "Upload a save": Pick (drop zone + FilePicker) → Preview +
 * Campaign → Result. Modal ≥1024px, BottomSheet below (`Bg3Overlay`, the
 * AddonImportDialog pattern). Errors are inline banners, never toasts. Close is
 * dirty-guarded while a save is parsed but not uploaded, and blocked while the
 * upload is in flight. The owner mounts it only while open.
 */
import { useState, type JSX } from 'react';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { useBg3Campaigns, useBg3MyUnassignedSaves } from '../hooks/use-bg3-hub';
import { Bg3Overlay } from '../campaign/bg3-overlay';
import { Bg3CampaignPicker } from '../campaign/bg3-campaign-picker';
import { Bg3StartCampaignDialog } from '../campaign/bg3-start-campaign-dialog';
import { Bg3UploadDropZone } from './bg3-upload-drop-zone';
import { Bg3UploadPreview } from './bg3-upload-preview';
import { Bg3UploadBanner } from './bg3-upload-banner';
import { useBg3UploadFlow } from './use-bg3-upload-flow';
import { bg3InitialUploadCampaign } from './bg3-upload-format';
import type { Bg3UploadResult } from './use-bg3-upload-save';

export interface Bg3UploadSaveSheetProps {
    readonly isOpen: boolean;
    readonly hubId: number;
    readonly onClose: () => void;
}

type Flow = ReturnType<typeof useBg3UploadFlow>;

const noop = (): void => {};
const BG3_UPLOAD_CAMPAIGN_ID = 'bg3-upload-campaign';

function resultText(result: Bg3UploadResult, campaigns: readonly Bg3CampaignSummary[]): string {
    const name = campaigns.find((c) => c.id === result.campaignId)?.name ?? 'your campaign';
    return `Uploaded to ${name}`;
}

interface BodyProps { flow: Flow; campaigns: readonly Bg3CampaignSummary[]; onNewCampaign: () => void }

function SheetBody({ flow, campaigns, onNewCampaign }: BodyProps): JSX.Element | null {
    if (flow.result !== null) {
        if (flow.result.status === 'already_uploaded') return <Bg3UploadBanner tone="info">Already uploaded.</Bg3UploadBanner>;
        return <Bg3UploadBanner tone="success">{resultText(flow.result, campaigns)}</Bg3UploadBanner>;
    }
    if (flow.parsed === null) return <Bg3UploadDropZone onFiles={flow.read} busy={flow.parsing} />;
    return (
        <>
            <Bg3UploadPreview save={flow.parsed.save} thumbUrl={flow.parsed.thumbUrl} />
            <div className="flex flex-col gap-1">
                <label htmlFor={BG3_UPLOAD_CAMPAIGN_ID} className="text-sm text-secondary">Campaign</label>
                <Bg3CampaignPicker id={BG3_UPLOAD_CAMPAIGN_ID} campaigns={campaigns} value={flow.campaignId}
                    onChange={flow.setCampaignId} onNewCampaign={onNewCampaign} disabled={flow.uploading} />
            </div>
        </>
    );
}

interface FooterProps { flow: Flow; onCancel: () => void; onDone: () => void; onUpload: () => void }

function SheetFooter({ flow, onCancel, onDone, onUpload }: FooterProps): JSX.Element {
    if (flow.result !== null) return <Button onClick={onDone}>Done</Button>;
    return (
        <>
            <Button variant="secondary" onClick={onCancel} disabled={flow.uploading}>Cancel</Button>
            {flow.parsed !== null && (
                <Button onClick={onUpload} loading={flow.uploading} loadingLabel="Uploading…" disabled={flow.campaignId === null}>
                    Upload
                </Button>
            )}
        </>
    );
}

export function Bg3UploadSaveSheet({ isOpen, hubId, onClose }: Bg3UploadSaveSheetProps): JSX.Element {
    const campaigns = useBg3Campaigns(hubId);
    const mine = useBg3MyUnassignedSaves();
    const list = campaigns.data?.campaigns ?? [];
    const defaultId = mine.data?.defaultCampaignId ?? null;
    const flow = useBg3UploadFlow(hubId, bg3InitialUploadCampaign(list, defaultId, campaigns.data?.settings.activeCampaignId ?? null));
    const [starting, setStarting] = useState(false);
    const guard = useDirtyCloseGuard(flow.parsed !== null && flow.result === null, onClose);
    const closeGuard = flow.uploading ? { ...guard, requestClose: noop } : guard;
    const footer = <SheetFooter flow={flow} onCancel={closeGuard.requestClose} onDone={onClose} onUpload={flow.submit} />;
    return (
        <>
            <Bg3Overlay isOpen={isOpen} title="Upload a save" onClose={flow.uploading ? noop : onClose} footer={footer}
                closeGuard={closeGuard} discardMessage="The save you picked won't be uploaded.">
                <div className="flex flex-col gap-4" data-testid="bg3-upload-save">
                    {flow.banner !== null && <Bg3UploadBanner tone={flow.banner.tone}>{flow.banner.text}</Bg3UploadBanner>}
                    <SheetBody flow={flow} campaigns={list} onNewCampaign={() => setStarting(true)} />
                </div>
            </Bg3Overlay>
            {starting && <Bg3StartCampaignDialog isOpen hubId={hubId} onClose={() => setStarting(false)}
                onCreated={(c) => flow.setCampaignId(c.id)} />}
        </>
    );
}

/**
 * ROK-1958 D-4 — "Start a campaign": a name (1–64) and a pre-checked "Put my
 * saves in this campaign" (POST the campaign, then PUT it as my default).
 * Exported for ROK-1960 (D-16). Close paths are dirty-guarded (§4.4).
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { useCreateBg3Campaign } from '../hooks/use-bg3-mutations';
import { Bg3Overlay } from './bg3-overlay';
import { toastBg3CampaignError } from './bg3-campaign-toast';
import { bg3CampaignNameError } from './bg3-campaign-name';

export interface Bg3StartCampaignDialogProps {
    readonly isOpen: boolean;
    readonly hubId: number;
    readonly onClose: () => void;
    readonly onCreated?: (campaign: Bg3CampaignSummary) => void;
}

function useStartForm(onClose: () => void) {
    const [name, setName] = useState('');
    const [putSaves, setPutSaves] = useState(true);
    const [showError, setShowError] = useState(false);
    const close = (): void => { setName(''); setPutSaves(true); setShowError(false); onClose(); };
    const guard = useDirtyCloseGuard(name !== '' || !putSaves, close);
    return { name, setName, putSaves, setPutSaves, showError, setShowError, close, guard };
}

function StartFooter({ formId, onCancel, pending }: { formId: string; onCancel: () => void; pending: boolean }): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" form={formId} loading={pending}>Start campaign</Button>
        </>
    );
}

export function Bg3StartCampaignDialog({ isOpen, hubId, onClose, onCreated }: Bg3StartCampaignDialogProps): JSX.Element {
    const formId = useId();
    const form = useStartForm(onClose);
    const create = useCreateBg3Campaign(hubId);
    const error = bg3CampaignNameError(form.name);
    const submit = (e: FormEvent): void => {
        e.preventDefault();
        if (error !== null) { form.setShowError(true); return; }
        create.mutate({ name: form.name.trim(), makeDefault: form.putSaves }, {
            onSuccess: (campaign) => { onCreated?.(campaign); form.close(); },
            onError: (err) => toastBg3CampaignError(err, "Couldn't start the campaign."),
        });
    };
    const footer = <StartFooter formId={formId} onCancel={form.guard.requestClose} pending={create.isPending} />;
    return (
        <Bg3Overlay isOpen={isOpen} title="Start a campaign" onClose={form.close} footer={footer}
            closeGuard={form.guard} discardMessage="The campaign name you typed will be lost.">
            <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="bg3-start-campaign">
                <Field label="Campaign name" required error={form.showError ? error ?? undefined : undefined}>
                    <Input value={form.name} onChange={(e) => form.setName(e.target.value)} autoComplete="off" />
                </Field>
                <Checkbox label="Put my saves in this campaign" checked={form.putSaves}
                    onChange={(e) => form.setPutSaves(e.target.checked)}
                    description="Saves you've uploaded that aren't in a campaign move here, and new ones follow. You can change this on the Campaign tab." />
            </form>
        </Bg3Overlay>
    );
}

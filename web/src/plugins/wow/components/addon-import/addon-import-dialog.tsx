/**
 * Addon "Import string" dialog (ROK-1724 §4.4): paste → preview → result.
 *
 * Modal at ≥1024px, BottomSheet below (`DESKTOP_MQ`). Errors render as inline
 * danger banners inside each step, never toasts. The one toast is an apply
 * that lands after the dialog was closed — the user would otherwise never see
 * it finish. The owner opens a fresh instance per session (the slot filler
 * keys it), so a reopened dialog always starts on an empty paste step.
 */
import { useEffect, useRef, useState } from 'react';
import type { AddonImportResultDto } from '@raid-ledger/contract';
import { Modal } from '../../../../components/ui/modal';
import { BottomSheet } from '../../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../../hooks/use-media-query';
import { useDirtyCloseGuard } from '../../../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../../../lib/breakpoints';
import { toast } from '../../../../lib/toast';
import { AddonImportPasteActions, AddonImportPasteStep } from './addon-import-paste-step';
import { AddonImportPreview, AddonImportPreviewActions } from './addon-import-preview';
import { AddonImportResult, AddonImportResultActions } from './addon-import-result';
import { resultHeadline } from './addon-import.helpers';
import { useAddonImportApply, useAddonImportPreview, type AddonImportConfirm } from './use-addon-import';

const TITLE = 'Import string';

export interface AddonImportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    characterId: string;
    /** The character's game id, for the name-mismatch Add Character link. */
    gameId?: number | undefined;
}

type Step = 'paste' | 'preview' | 'result';

/** Mirrors `isOpen` into a ref so an apply that settles later can tell whether the dialog is still open. */
function useIsOpenRef(isOpen: boolean) {
    const ref = useRef(isOpen);
    useEffect(() => { ref.current = isOpen; }, [isOpen]);
    return ref;
}

function useAddonImportFlow(characterId: string, isOpen: boolean) {
    const [text, setText] = useState('');
    const [step, setStep] = useState<Step>('paste');
    const [checked, setChecked] = useState<{ importString: string; result: AddonImportResultDto } | null>(null);
    const [applied, setApplied] = useState<AddonImportResultDto | null>(null);
    const [confirm, setConfirm] = useState<AddonImportConfirm>({});
    const preview = useAddonImportPreview(characterId);
    const apply = useAddonImportApply(characterId);
    const openRef = useIsOpenRef(isOpen);

    const check = (importString: string) => preview.mutate({ importString }, {
        onSuccess: (result) => { apply.reset(); setChecked({ importString, result }); setConfirm({}); setStep('preview'); },
    });
    const runImport = () => {
        if (!checked) return;
        apply.mutate({ importString: checked.importString, confirm }, {
            onSuccess: (result) => {
                setApplied(result); setStep('result');
                if (!openRef.current) toast.success(resultHeadline(result));
            },
        });
    };
    const back = () => { apply.reset(); setStep('paste'); };
    const again = () => { setText(''); setChecked(null); setApplied(null); preview.reset(); apply.reset(); setStep('paste'); };
    return { text, setText, step, checked, applied, confirm, setConfirm, preview, apply, check, runImport, back, again };
}

type Flow = ReturnType<typeof useAddonImportFlow>;

function StepBody({ flow, gameId }: { flow: Flow; gameId?: number | undefined }) {
    if (flow.step === 'result' && flow.applied) return <AddonImportResult result={flow.applied} />;
    if (flow.step === 'preview' && flow.checked) {
        return <AddonImportPreview result={flow.checked.result} confirm={flow.confirm} onConfirmChange={flow.setConfirm} error={flow.apply.error} gameId={gameId} />;
    }
    return <AddonImportPasteStep value={flow.text} onChange={flow.setText} onCheck={flow.check} error={flow.preview.error} gameId={gameId} />;
}

function StepFooter({ flow, onCancel, onDone }: { flow: Flow; onCancel: () => void; onDone: () => void }) {
    if (flow.step === 'result') return <AddonImportResultActions onImportAnother={flow.again} onDone={onDone} />;
    if (flow.step === 'preview' && flow.checked) {
        return <AddonImportPreviewActions result={flow.checked.result} confirm={flow.confirm} onBack={flow.back} onImport={flow.runImport} importing={flow.apply.isPending} />;
    }
    return <AddonImportPasteActions value={flow.text} onCheck={flow.check} onCancel={onCancel} checking={flow.preview.isPending} />;
}

export function AddonImportDialog({ isOpen, onClose, characterId, gameId }: AddonImportDialogProps) {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const flow = useAddonImportFlow(characterId, isOpen);
    // A pasted string is unsaved work until it has been imported.
    const guard = useDirtyCloseGuard(flow.text.length > 0 && flow.step !== 'result', onClose);
    const body = <StepBody flow={flow} gameId={gameId} />;
    const footer = <StepFooter flow={flow} onCancel={guard.requestClose} onDone={onClose} />;
    const discardMessage = 'Discard the pasted import string?';
    if (isDesktop) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} closeGuard={guard} discardMessage={discardMessage} title={TITLE} maxWidth="max-w-lg" footer={footer}>
                {body}
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} closeGuard={guard} discardMessage={discardMessage} title={TITLE} footer={footer}>
            {body}
        </BottomSheet>
    );
}

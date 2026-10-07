/**
 * Addon "Import string" dialog (ROK-1724 §4.4): paste → preview → result.
 *
 * Modal at ≥1024px, BottomSheet below (`DESKTOP_MQ`). Errors render as inline
 * danger banners inside each step, never toasts. The one toast is an apply
 * that lands after the dialog was closed — the user would otherwise never see
 * it finish. The owner opens a fresh instance per session (the slot filler
 * keys it), so a reopened dialog always starts on an empty paste step.
 *
 * ROK-1738 `mode="create"`: Add Character's "Import LedgerLink character".
 * Posts to the id-less route, previews the resolved create/update target (+
 * the ruleset picker when the export has none), and on confirm calls
 * `onCreated` instead of showing a result step. On phones the sheet is
 * `stacked` so it renders above the Add Character Modal (D9).
 */
import type { AddonImportNewResultDto } from '@raid-ledger/contract';
import { Modal } from '../../../../components/ui/modal';
import { BottomSheet } from '../../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../../hooks/use-media-query';
import { useDirtyCloseGuard } from '../../../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../../../lib/breakpoints';
import { AddonImportPasteActions, AddonImportPasteStep } from './addon-import-paste-step';
import { AddonImportPreview, AddonImportPreviewActions } from './addon-import-preview';
import { AddonImportResult, AddonImportResultActions } from './addon-import-result';
import { needsRulesetPick, useAddonImportFlow, type AddonImportFlow, type AddonImportMode } from './use-addon-import-flow';

const TITLE = 'Import string';
const CREATE_TITLE = 'Import LedgerLink character';

interface DialogBaseProps {
    isOpen: boolean;
    onClose: () => void;
}

/** The ROK-1724 per-character dialog (character page "Import string"). */
export interface AddonImportCharacterDialogProps extends DialogBaseProps {
    mode?: 'character' | undefined;
    characterId: string;
    /** The character's game id, for the name-mismatch Add Character link. */
    gameId?: number | undefined;
}

/** ROK-1738 create mode, stacked over Add Character: confirm hands the result to `onCreated` (no result step). */
export interface AddonImportCreateDialogProps extends DialogBaseProps {
    mode: 'create';
    onCreated: (result: AddonImportNewResultDto) => void;
}

export type AddonImportDialogProps = AddonImportCharacterDialogProps | AddonImportCreateDialogProps;

function toMode(props: AddonImportDialogProps): AddonImportMode {
    return props.mode === 'create' ? { mode: 'create', onCreated: props.onCreated } : { mode: 'character', characterId: props.characterId };
}

type Flow = AddonImportFlow;

function StepBody({ flow, gameId }: { flow: Flow; gameId?: number | undefined }) {
    if (flow.step === 'result' && flow.applied) return <AddonImportResult result={flow.applied} />;
    if (flow.step === 'preview' && flow.checked) {
        return (
            <AddonImportPreview
                result={flow.checked.result} confirm={flow.confirm} onConfirmChange={flow.setConfirm} error={flow.apply.error} gameId={gameId}
                target={flow.checked.target} ruleset={flow.ruleset} onRulesetChange={flow.setRuleset}
            />
        );
    }
    return <AddonImportPasteStep value={flow.text} onChange={flow.setText} onCheck={flow.check} error={flow.preview.error} gameId={gameId} />;
}

function StepFooter({ flow, onCancel, onDone }: { flow: Flow; onCancel: () => void; onDone: () => void }) {
    if (flow.step === 'result') return <AddonImportResultActions onImportAnother={flow.again} onDone={onDone} />;
    if (flow.step === 'preview' && flow.checked) {
        const rulesetMissing = needsRulesetPick(flow.checked.target) && flow.ruleset === null;
        return (
            <AddonImportPreviewActions
                result={flow.checked.result} confirm={flow.confirm} onBack={flow.back} onImport={flow.runImport}
                importing={flow.apply.isPending} rulesetMissing={rulesetMissing}
            />
        );
    }
    return <AddonImportPasteActions value={flow.text} onCheck={flow.check} onCancel={onCancel} checking={flow.preview.isPending} />;
}

export function AddonImportDialog(props: AddonImportDialogProps) {
    const { isOpen, onClose } = props;
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const flow = useAddonImportFlow(toMode(props), isOpen);
    // A pasted string is unsaved work until it has been imported.
    const guard = useDirtyCloseGuard(flow.text.length > 0 && flow.step !== 'result', onClose);
    // Create mode lives inside Add Character: no "Add Character" link on a name mismatch.
    const gameId = props.mode === 'create' ? undefined : props.gameId;
    const title = props.mode === 'create' ? CREATE_TITLE : TITLE;
    const body = <StepBody flow={flow} gameId={gameId} />;
    const footer = <StepFooter flow={flow} onCancel={guard.requestClose} onDone={onClose} />;
    const shared = { isOpen, onClose, closeGuard: guard, discardMessage: 'Discard the pasted import string?', title, footer };
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{body}</Modal>;
    // Over the Add Character Modal a phone sheet must lift to the modal layer (D9).
    return <BottomSheet {...shared} stacked={props.mode === 'create'}>{body}</BottomSheet>;
}

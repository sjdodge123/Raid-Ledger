/**
 * ROK-2068 — the confirm step of Manage my saves, shown inside the same
 * overlay (no stacked dialog). Operator ruling 2026-11-03 (Q3 = clear the
 * latest-wins markers): a re-sent copy of a removed save is accepted again, so
 * the copy says it would be added again — never that removed saves stay gone.
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import { saveCountLabel } from '../lib/bg3-playthroughs';

export const BG3_REMOVE_SAVES_CONFIRM_LABEL = 'Remove saves';
export const BG3_REMOVE_SAVES_RESEND_NOTE = 'If your Companion sends one of these saves again, it will be added again.';

export interface Bg3RemoveSavesConfirmProps {
    /** Saves the picked playthroughs hold. */
    readonly saves: number;
    /** The list's page walk hit its safety stop, so `saves` is a floor. */
    readonly capped: boolean;
}

export function Bg3RemoveSavesConfirm({ saves, capped }: Bg3RemoveSavesConfirmProps): JSX.Element {
    return (
        <div className="flex flex-col gap-3" data-testid="bg3-remove-saves-confirm">
            <p className="text-sm text-secondary">
                This deletes {saveCountLabel(saves, capped)} you uploaded and their pictures in hub Galleries. It can't be undone.
            </p>
            <p className="text-sm text-muted">{BG3_REMOVE_SAVES_RESEND_NOTE}</p>
        </div>
    );
}

export interface Bg3RemoveSavesConfirmFooterProps {
    readonly pending: boolean;
    readonly onBack: () => void;
    readonly onConfirm: () => void;
}

export function Bg3RemoveSavesConfirmFooter({ pending, onBack, onConfirm }: Bg3RemoveSavesConfirmFooterProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onBack} disabled={pending}>Back</Button>
            <Button variant="destructive" onClick={onConfirm} loading={pending}>{BG3_REMOVE_SAVES_CONFIRM_LABEL}</Button>
        </>
    );
}

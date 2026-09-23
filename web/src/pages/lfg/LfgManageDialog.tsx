/**
 * ROK-1573 (approved H2) — the ⋯ Manage dialog in the LFG top bar: "When do
 * you want to play?" (the real `LfgUrgencyChoice`), then Withdraw as a danger
 * sheet row. Replaces the standalone Withdraw button. Pure props in.
 */
import type { JSX } from 'react';
import type { LfgUrgency } from '@raid-ledger/contract';
import { LfgUrgencyChoice, type LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { SCHEDULING_SHEET_ROW_DANGER } from '../../components/lineups/cycle-4/scheduling-action-button';
import { LFG_COPY } from './lfg-copy';
import { LFG_DIALOG_COPY } from './lfg-dialog-recipes';
import { LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgManageDialogProps {
    isOpen: boolean;
    gameName: string;
    /** The viewer's current urgency, or null when they hold no intent. */
    ownUrgency: LfgUrgency | null;
    onPickUrgency: (pick: LfgUrgencyPick) => void;
    onWithdraw: () => void;
    isWithdrawing?: boolean;
    onClose: () => void;
    /**
     * ROK-1619 AC7: `pressWouldSpawnNow` from the group read. The server
     * already answers false for a viewer holding a now-hand, so a viewer on
     * `Tonight`/`This week` one short of the threshold sees the glyph on
     * `Right now` here exactly as on the group page's join control.
     */
    spawnsNow?: boolean;
    /** The server-resolved indicator glyph (`spawnIndicatorEmoji`). */
    spawnEmoji?: string;
}

/**
 * `You're in · Right now. Pick again to change it.`
 *
 * A Record, not a ternary: ROK-1616's third horizon would otherwise have been
 * silently reported as `This week` by the `else` branch, and TypeScript would
 * not have said a word. Every `LfgUrgency` must name itself here.
 */
const URGENCY_LABEL: Record<LfgUrgency, string> = {
    now: LFG_DIALOG_COPY.urgencyNowLabel,
    tonight: LFG_COPY.urgencyTonight,
    week: LFG_COPY.urgencyWeek,
};

function currentLine(urgency: LfgUrgency): string {
    return `You're in · ${URGENCY_LABEL[urgency]}. ${LFG_DIALOG_COPY.pickAgain}`;
}

/** Withdraw as a danger sheet row — "Leave the group". */
function WithdrawRow({ isWithdrawing, onWithdraw }: { isWithdrawing: boolean; onWithdraw: () => void }): JSX.Element {
    return (
        <div className="border-t border-edge pt-1">
            <button
                type="button"
                data-testid="lfg-manage-withdraw"
                className={SCHEDULING_SHEET_ROW_DANGER}
                disabled={isWithdrawing}
                aria-busy={isWithdrawing}
                onClick={onWithdraw}
            >
                <span>{LFG_COPY.withdraw}</span>
                <span className="text-xs font-normal text-muted">{LFG_DIALOG_COPY.withdrawNote}</span>
            </button>
        </div>
    );
}

export function LfgManageDialog({
    isOpen, gameName, ownUrgency, onPickUrgency, onWithdraw, isWithdrawing = false, onClose,
    spawnsNow, spawnEmoji,
}: LfgManageDialogProps): JSX.Element | null {
    const spawnGlyph = spawnsNow ? spawnEmoji : undefined;
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onClose} title={LFG_DIALOG_COPY.manageTitle}>
            <div data-testid="lfg-manage-body" className="space-y-3">
                <div className="space-y-2 px-3">
                    <p className="text-sm font-medium text-foreground">{LFG_COPY.urgencyPrompt}</p>
                    {ownUrgency && <p className="text-xs text-muted">{currentLine(ownUrgency)}</p>}
                    <div className="[&_button]:min-h-[44px] lg:[&_button]:min-h-0">
                        <LfgUrgencyChoice label={gameName} disabled={isWithdrawing} onPick={onPickUrgency}
                            spawnGlyph={spawnGlyph} />
                    </div>
                </div>
                {ownUrgency && <WithdrawRow isWithdrawing={isWithdrawing} onWithdraw={onWithdraw} />}
            </div>
        </LfgSheetOrModal>
    );
}

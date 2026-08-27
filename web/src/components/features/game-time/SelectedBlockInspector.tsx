import type { JSX } from 'react';
import { FULL_DAYS, formatHour } from './game-time-grid.utils';
import type { SlotBlock } from './slot-blocks.utils';
import { maxEndIndex, minStartIndex } from './slot-blocks.utils';
import type { GameTimeSlot } from '@raid-ledger/contract';

interface SelectedBlockInspectorProps {
    selection: SlotBlock;
    slots: GameTimeSlot[];
    hours: number[];
    onAdjust: (edge: 'start' | 'end', delta: number) => void;
    onRemove: () => void;
    onDone: () => void;
}

const endHourOf = (endIndex: number, hours: number[]): number =>
    endIndex >= hours.length ? (hours[hours.length - 1] + 1) % 24 : hours[endIndex];

/**
 * Editor for the selected block (ROK-1426).
 *
 * The steppers are the precise path — a day column is far narrower than the 44px
 * touch guideline even when a selected block widens — and the accessible one:
 * real buttons, reachable by keyboard, where dragging a handle is not.
 */
export function SelectedBlockInspector({
    selection, slots, hours, onAdjust, onRemove, onDone,
}: SelectedBlockInspectorProps): JSX.Element {
    const { dayOfWeek, startIndex, endIndex } = selection;
    const floor = minStartIndex(slots, dayOfWeek, endIndex, hours);
    const ceiling = maxEndIndex(slots, dayOfWeek, startIndex, hours);

    return (
        <div
            className="mt-2 p-2.5 rounded-lg border border-edge bg-panel/60 flex flex-col gap-2"
            data-testid="selected-block-inspector"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{FULL_DAYS[dayOfWeek]}</span>
                <div className="flex items-center gap-2">
                    <button
                        type="button" onClick={onRemove}
                        className="px-2 py-1 text-xs font-medium rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                        data-testid="remove-block"
                    >
                        Remove
                    </button>
                    <button
                        type="button" onClick={onDone}
                        className="px-2 py-1 text-xs font-medium rounded border border-edge text-muted hover:text-foreground transition-colors"
                        data-testid="deselect-block"
                    >
                        Done
                    </button>
                </div>
            </div>
            <div className="flex gap-2">
                <Stepper
                    label="Start" value={formatHour(hours[startIndex])} testId="start"
                    onDown={() => onAdjust('start', -1)} onUp={() => onAdjust('start', 1)}
                    downDisabled={startIndex <= floor} upDisabled={startIndex >= endIndex - 1}
                />
                <Stepper
                    label="End" value={formatHour(endHourOf(endIndex, hours))} testId="end"
                    onDown={() => onAdjust('end', -1)} onUp={() => onAdjust('end', 1)}
                    downDisabled={endIndex <= startIndex + 1} upDisabled={endIndex >= ceiling}
                />
            </div>
        </div>
    );
}

function Stepper({ label, value, testId, onDown, onUp, downDisabled, upDisabled }: {
    label: string; value: string; testId: string;
    onDown: () => void; onUp: () => void; downDisabled: boolean; upDisabled: boolean;
}): JSX.Element {
    return (
        <div className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-edge bg-surface">
            <span className="text-[10px] uppercase tracking-wide text-muted w-8 shrink-0">{label}</span>
            <StepButton onClick={onDown} disabled={downDisabled} label={`Move ${label.toLowerCase()} one hour earlier`} testId={`${testId}-earlier`}>&minus;</StepButton>
            <span className="flex-1 text-center text-xs tabular-nums text-foreground" data-testid={`${testId}-value`}>{value}</span>
            <StepButton onClick={onUp} disabled={upDisabled} label={`Move ${label.toLowerCase()} one hour later`} testId={`${testId}-later`}>+</StepButton>
        </div>
    );
}

function StepButton({ onClick, disabled, label, testId, children }: {
    onClick: () => void; disabled: boolean; label: string; testId: string; children: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button" onClick={onClick} disabled={disabled} aria-label={label}
            className="w-6 h-6 shrink-0 rounded border border-edge bg-panel text-foreground text-sm leading-none font-bold disabled:opacity-35 disabled:cursor-default hover:enabled:bg-overlay transition-colors"
            data-testid={testId}
        >
            {children}
        </button>
    );
}

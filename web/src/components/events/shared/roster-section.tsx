import { useMemo } from 'react';
import { SlotStepper } from './slot-stepper';
import '../../../pages/event-detail-page.css';

export interface RosterSectionProps {
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotFlex: number;
    slotPlayer: number;
    slotBench: number;
    maxAttendees: string;
    autoUnbench: boolean;
    maxAttendeesError?: string;
    maxAttendeesId?: string;
    onSlotTypeChange: (type: 'mmo' | 'generic') => void;
    onSlotTankChange: (v: number) => void;
    onSlotHealerChange: (v: number) => void;
    onSlotDpsChange: (v: number) => void;
    onSlotFlexChange: (v: number) => void;
    onSlotPlayerChange: (v: number) => void;
    onSlotBenchChange: (v: number) => void;
    onMaxAttendeesChange: (v: string) => void;
    onAutoUnbenchChange: (v: boolean) => void;
}

export function RosterSection({
    slotType,
    slotTank,
    slotHealer,
    slotDps,
    slotFlex,
    slotPlayer,
    slotBench,
    maxAttendees,
    autoUnbench,
    maxAttendeesError,
    maxAttendeesId = 'maxAttendees',
    onSlotTypeChange,
    onSlotTankChange,
    onSlotHealerChange,
    onSlotDpsChange,
    onSlotFlexChange,
    onSlotPlayerChange,
    onSlotBenchChange,
    onMaxAttendeesChange,
    onAutoUnbenchChange,
}: RosterSectionProps) {
    const totalSlots = useMemo(() => {
        if (slotType === 'mmo') {
            return slotTank + slotHealer + slotDps + slotFlex + slotBench;
        }
        return slotPlayer + slotBench;
    }, [slotType, slotTank, slotHealer, slotDps, slotFlex, slotPlayer, slotBench]);

    return (
        <>
            {/* Slot Type Toggle */}
            <div>
                <label className="block text-sm font-medium text-secondary mb-2">Slot Type</label>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onSlotTypeChange('mmo')}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            slotType === 'mmo'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-panel border border-edge text-secondary hover:text-foreground'
                        }`}
                    >
                        MMO Roles
                    </button>
                    <button
                        type="button"
                        onClick={() => onSlotTypeChange('generic')}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            slotType === 'generic'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-panel border border-edge text-secondary hover:text-foreground'
                        }`}
                    >
                        Generic Slots
                    </button>
                </div>
            </div>

            {/* Slot Steppers */}
            <div className="bg-panel/50 border border-edge-subtle rounded-lg px-4 divide-y divide-edge-subtle">
                {slotType === 'mmo' ? (
                    <>
                        <SlotStepper label="Tank" value={slotTank} onChange={onSlotTankChange} color="bg-blue-500" />
                        <SlotStepper label="Healer" value={slotHealer} onChange={onSlotHealerChange} color="bg-green-500" />
                        <SlotStepper label="DPS" value={slotDps} onChange={onSlotDpsChange} color="bg-red-500" />
                        <SlotStepper label="Flex" value={slotFlex} onChange={onSlotFlexChange} color="bg-purple-500" />
                    </>
                ) : (
                    <SlotStepper label="Players" value={slotPlayer} onChange={onSlotPlayerChange} color="bg-indigo-500" />
                )}
                <SlotStepper label="Bench" value={slotBench} onChange={onSlotBenchChange} color="bg-gray-500" />
            </div>

            <div className="text-sm text-muted">
                Total slots: <span className="text-emerald-400 font-medium">{totalSlots}</span>
                {slotBench > 0 && (
                    <span className="text-dim"> (incl. {slotBench} bench)</span>
                )}
            </div>

            {/* Max Attendees */}
            <div>
                <label htmlFor={maxAttendeesId} className="block text-sm font-medium text-secondary mb-2">
                    Max Attendees
                </label>
                <input
                    id={maxAttendeesId}
                    type="number"
                    min={1}
                    value={maxAttendees}
                    onChange={(e) => onMaxAttendeesChange(e.target.value)}
                    placeholder="Unlimited"
                    className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${maxAttendeesError ? 'border-red-500' : 'border-edge'}`}
                />
                <p className="mt-1 text-xs text-dim">Leave empty for unlimited</p>
                {maxAttendeesError && (
                    <p className="mt-1 text-sm text-red-400">{maxAttendeesError}</p>
                )}
            </div>

            {/* Auto-Unbench Toggle */}
            <div className="flex items-center justify-between gap-3">
                <div>
                    <span className="text-sm font-medium text-secondary">Auto-promote benched players</span>
                    <p className="text-xs text-dim mt-0.5">
                        When a roster slot opens, automatically move the next benched player in
                    </p>
                </div>
                <div className="event-detail-autosub-toggle shrink-0">
                    <div
                        className="event-detail-autosub-toggle__track"
                        role="switch"
                        aria-checked={autoUnbench}
                        aria-label="Auto-promote benched players"
                        tabIndex={0}
                        onClick={() => onAutoUnbenchChange(!autoUnbench)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAutoUnbenchChange(!autoUnbench); } }}
                    >
                        <span className={`event-detail-autosub-toggle__option ${autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                        <span className={`event-detail-autosub-toggle__option ${!autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                    </div>
                </div>
            </div>
        </>
    );
}

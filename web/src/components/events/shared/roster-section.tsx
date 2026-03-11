import { useMemo } from 'react';
import { SlotStepper } from './slot-stepper';
import '../../../pages/event-detail-page.css';

export interface RosterSectionProps {
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotPlayer: number;
    maxAttendees: string;
    autoUnbench: boolean;
    maxAttendeesError?: string;
    maxAttendeesId?: string;
    onSlotTypeChange: (type: 'mmo' | 'generic') => void;
    onSlotTankChange: (v: number) => void;
    onSlotHealerChange: (v: number) => void;
    onSlotDpsChange: (v: number) => void;
    onSlotPlayerChange: (v: number) => void;
    onMaxAttendeesChange: (v: string) => void;
    onAutoUnbenchChange: (v: boolean) => void;
}

function SlotTypeToggle({ slotType, onChange }: { slotType: 'mmo' | 'generic'; onChange: (t: 'mmo' | 'generic') => void }) {
    const btnClass = (active: boolean) =>
        `flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-emerald-600 text-white' : 'bg-panel border border-edge text-secondary hover:text-foreground'}`;
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-2">Slot Type</label>
            <div className="flex gap-2">
                <button type="button" onClick={() => onChange('mmo')} className={btnClass(slotType === 'mmo')}>MMO Roles</button>
                <button type="button" onClick={() => onChange('generic')} className={btnClass(slotType === 'generic')}>Generic Slots</button>
            </div>
        </div>
    );
}

function SlotSteppers(props: RosterSectionProps) {
    return (
        <div className="bg-panel/50 border border-edge-subtle rounded-lg px-4 divide-y divide-edge-subtle">
            {props.slotType === 'mmo' ? (
                <>
                    <SlotStepper label="Tank" value={props.slotTank} onChange={props.onSlotTankChange} color="bg-blue-500" />
                    <SlotStepper label="Healer" value={props.slotHealer} onChange={props.onSlotHealerChange} color="bg-green-500" />
                    <SlotStepper label="DPS" value={props.slotDps} onChange={props.onSlotDpsChange} color="bg-red-500" />
                </>
            ) : (
                <SlotStepper label="Players" value={props.slotPlayer} onChange={props.onSlotPlayerChange} color="bg-indigo-500" />
            )}
        </div>
    );
}

function MaxAttendeesField({ maxAttendees, maxAttendeesError, maxAttendeesId, onChange }: {
    maxAttendees: string; maxAttendeesError?: string; maxAttendeesId: string; onChange: (v: string) => void;
}) {
    return (
        <div>
            <label htmlFor={maxAttendeesId} className="block text-sm font-medium text-secondary mb-2">Max Attendees</label>
            <input id={maxAttendeesId} type="number" min={1} value={maxAttendees} onChange={(e) => onChange(e.target.value)}
                placeholder="Unlimited"
                className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${maxAttendeesError ? 'border-red-500' : 'border-edge'}`} />
            <p className="mt-1 text-xs text-dim">Leave empty for unlimited</p>
            {maxAttendeesError && <p className="mt-1 text-sm text-red-400">{maxAttendeesError}</p>}
        </div>
    );
}

function AutoUnbenchToggle({ autoUnbench, onChange }: { autoUnbench: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div>
                <span className="text-sm font-medium text-secondary">Auto-promote benched players</span>
                <p className="text-xs text-dim mt-0.5">When a roster slot opens, automatically move the next benched player in</p>
            </div>
            <div className="event-detail-autosub-toggle shrink-0">
                <div className="event-detail-autosub-toggle__track" role="switch" aria-checked={autoUnbench}
                    aria-label="Auto-promote benched players" tabIndex={0}
                    onClick={() => onChange(!autoUnbench)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!autoUnbench); } }}>
                    <span className={`event-detail-autosub-toggle__option ${autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                    <span className={`event-detail-autosub-toggle__option ${!autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                </div>
            </div>
        </div>
    );
}

export function RosterSection(props: RosterSectionProps) {
    const { maxAttendeesId = 'maxAttendees' } = props;
    const totalSlots = useMemo(() => {
        return props.slotType === 'mmo'
            ? props.slotTank + props.slotHealer + props.slotDps
            : props.slotPlayer;
    }, [props.slotType, props.slotTank, props.slotHealer, props.slotDps, props.slotPlayer]);

    return (
        <>
            <SlotTypeToggle slotType={props.slotType} onChange={props.onSlotTypeChange} />
            <SlotSteppers {...props} />
            <div className="text-sm text-muted">Total slots: <span className="text-emerald-400 font-medium">{totalSlots}</span></div>
            <MaxAttendeesField maxAttendees={props.maxAttendees} maxAttendeesError={props.maxAttendeesError}
                maxAttendeesId={maxAttendeesId} onChange={props.onMaxAttendeesChange} />
            <AutoUnbenchToggle autoUnbench={props.autoUnbench} onChange={props.onAutoUnbenchChange} />
        </>
    );
}

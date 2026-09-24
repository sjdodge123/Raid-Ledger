import { useMemo } from 'react';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { RadioGroup } from '../../ui/radio-group';
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

type SlotType = RosterSectionProps['slotType'];

const SLOT_TYPE_OPTIONS = [
    { value: 'mmo', label: 'MMO Roles' },
    { value: 'generic', label: 'Generic Slots' },
] as const;

/** ROK-1649: a segmented RadioGroup (was two hand-painted toggle buttons). */
function SlotTypeToggle({ slotType, onChange }: { slotType: SlotType; onChange: (t: SlotType) => void }) {
    return (
        <RadioGroup<SlotType> label="Slot Type" appearance="segmented" options={SLOT_TYPE_OPTIONS}
            value={slotType} onChange={onChange} />
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

/** ROK-1649: Field + Input; `maxAttendeesId` stays the control id (scroll-to-error target). */
function MaxAttendeesField({ maxAttendees, maxAttendeesError, maxAttendeesId, onChange }: {
    maxAttendees: string; maxAttendeesError?: string; maxAttendeesId: string; onChange: (v: string) => void;
}) {
    return (
        <Field label="Max Attendees" id={maxAttendeesId} hint="Leave empty for unlimited" error={maxAttendeesError}>
            <Input type="number" inputMode="numeric" min={1} value={maxAttendees} placeholder="Unlimited"
                onChange={(e) => onChange(e.target.value)} />
        </Field>
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
            <div className="text-sm text-muted">Total slots: <span className="text-success font-medium">{totalSlots}</span></div>
            <MaxAttendeesField maxAttendees={props.maxAttendees} maxAttendeesError={props.maxAttendeesError}
                maxAttendeesId={maxAttendeesId} onChange={props.onMaxAttendeesChange} />
            <AutoUnbenchToggle autoUnbench={props.autoUnbench} onChange={props.onAutoUnbenchChange} />
        </>
    );
}

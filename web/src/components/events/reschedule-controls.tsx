/**
 * Reschedule modal controls (ROK-1649 lane B8): the neutral poll callout
 * (ruling 9), the shared Duration radiogroup, the New start field and the
 * confirm bar — all on the ui primitives, tokens only.
 */
import type { JSX } from 'react';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { DurationPresetGroup, type DurationChoice } from './shared/duration-preset-group';
import { DURATION_PRESETS, moveToLabel } from './reschedule-utils';

export function PollBanner({ onPoll, isPending, disabled }: { onPoll: () => void; isPending: boolean; disabled?: boolean }): JSX.Element {
    return (
        <div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border border-edge bg-overlay/30 px-3 py-2.5">
            <p className="text-sm text-foreground flex-1">Let your community decide -- post a Discord poll for the best time</p>
            <Button variant="primary" size="sm" className="shrink-0" onClick={onPoll} disabled={disabled}
                loading={isPending} loadingLabel="Converting...">
                Poll for Best Time
            </Button>
        </div>
    );
}

/** One number box of the custom duration with its visible unit. */
function DurationPart({ label, unit, value, max, step, onChange }: {
    label: string; unit: string; value: number; max: number; step?: number; onChange: (v: number) => void;
}): JSX.Element {
    return (
        <>
            <Input type="number" inputMode="numeric" fieldSize="sm" aria-label={label} min={0} max={max} step={step}
                value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-16 text-center" />
            <span className="text-xs text-muted">{unit}</span>
        </>
    );
}

export function CustomDurationInputs({ durationMinutes, setDurationMinutes }: { durationMinutes: number; setDurationMinutes: (v: number) => void }): JSX.Element {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return (
        <div className="flex items-center gap-2 mt-1.5">
            <DurationPart label="Duration hours" unit="hr" value={hours} max={23} onChange={(h) => setDurationMinutes(h * 60 + minutes)} />
            <DurationPart label="Duration minutes" unit="min" value={minutes} max={59} step={15} onChange={(m) => setDurationMinutes(hours * 60 + m)} />
        </div>
    );
}

export function StartTimeInput({ newStartTime, onStartChange }: { newStartTime: string | null; onStartChange: (v: string) => void }): JSX.Element {
    return (
        <Field label="New start" id="reschedule-start" className="flex-1">
            <Input type="datetime-local" fieldSize="sm" value={newStartTime ?? ''} onChange={(e) => onStartChange(e.target.value)} />
        </Field>
    );
}

export function DurationSelector(props: {
    durationMinutes: number; setDurationMinutes: (v: number) => void;
    customDuration: boolean; setCustomDuration: (v: boolean) => void;
}): JSX.Element {
    const choose = (choice: DurationChoice) => {
        if (choice === 'custom') { props.setCustomDuration(true); return; }
        props.setDurationMinutes(choice);
        props.setCustomDuration(false);
    };
    return (
        <div className="flex-1">
            <DurationPresetGroup presets={DURATION_PRESETS} value={props.customDuration ? 'custom' : props.durationMinutes} onChange={choose} />
            {props.customDuration && <CustomDurationInputs durationMinutes={props.durationMinutes} setDurationMinutes={props.setDurationMinutes} />}
        </div>
    );
}

export function ConfirmationMessage({ eventTitle, isValid, parsedStart, parsedEnd, selectionSummary, signupCount }: {
    eventTitle: string; isValid: boolean; parsedStart: Date | null; parsedEnd: Date | null;
    selectionSummary: string | null; signupCount: number;
}): JSX.Element {
    if (!isValid) {
        return (
            <span className="text-danger">
                {parsedStart && parsedEnd && parsedStart >= parsedEnd ? 'Start time must be before end time' : 'Start time must be in the future'}
            </span>
        );
    }
    return (
        <>Move <span className="font-semibold">{eventTitle}</span> to{' '}
            <span className="font-semibold text-success">{selectionSummary}</span>?
            {signupCount > 0 && (
                <span className="text-muted"> All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.</span>
            )}
        </>
    );
}

export function ConfirmationBar({ eventTitle, isValid, parsedStart, parsedEnd, selectionSummary, signupCount, isPending, onClear, onConfirm }: {
    eventTitle: string; isValid: boolean; parsedStart: Date | null; parsedEnd: Date | null;
    selectionSummary: string | null; signupCount: number; isPending: boolean;
    onClear: () => void; onConfirm: () => void;
}): JSX.Element {
    return (
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
            <p className="text-sm text-foreground">
                <ConfirmationMessage eventTitle={eventTitle} isValid={isValid} parsedStart={parsedStart}
                    parsedEnd={parsedEnd} selectionSummary={selectionSummary} signupCount={signupCount} />
            </p>
            <div className="flex gap-2 shrink-0">
                <Button variant="secondary" size="sm" onClick={onClear}>Clear</Button>
                <Button variant="primary" size="sm" onClick={onConfirm} disabled={!isValid}
                    loading={isPending} loadingLabel="Rescheduling...">
                    {moveToLabel(parsedStart)}
                </Button>
            </div>
        </div>
    );
}

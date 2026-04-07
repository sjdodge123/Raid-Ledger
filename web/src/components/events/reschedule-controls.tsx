import { DURATION_PRESETS } from './reschedule-utils';

export function PollBanner({ onPoll, isPending, disabled }: { onPoll: () => void; isPending: boolean; disabled?: boolean }) {
    return (
        <div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
            <p className="text-sm text-foreground flex-1">Let your community decide -- post a Discord poll for the best time</p>
            <button onClick={onPoll} disabled={isPending || disabled}
                className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm font-medium text-white transition-colors">
                {isPending ? 'Converting...' : 'Poll for Best Time'}
            </button>
        </div>
    );
}

export function GridLegend({ hasSelection }: { hasSelection: boolean }) {
    return (
        <div className="shrink-0 flex items-center gap-4 text-xs text-muted">
            {hasSelection && (
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm border-2 border-solid" style={{ borderColor: 'rgba(6, 182, 212, 0.95)' }} />
                    <span>New time</span>
                </div>
            )}
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.4)' }} /><span>Few</span>
            </div>
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(234, 179, 8, 0.45)' }} /><span>Some</span>
            </div>
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.55)' }} /><span>All available</span>
            </div>
        </div>
    );
}

export function DurationPresetButtons({ durationMinutes, customDuration, setDurationMinutes, setCustomDuration }: {
    durationMinutes: number; customDuration: boolean;
    setDurationMinutes: (v: number) => void; setCustomDuration: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {DURATION_PRESETS.map((p) => (
                <button key={p.minutes} type="button"
                    onClick={() => { setDurationMinutes(p.minutes); setCustomDuration(false); }}
                    className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${!customDuration && durationMinutes === p.minutes
                        ? 'bg-emerald-600 text-white' : 'bg-panel border border-edge text-secondary hover:text-foreground'}`}>
                    {p.label}
                </button>
            ))}
            <button type="button" onClick={() => setCustomDuration(true)}
                className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${customDuration
                    ? 'bg-emerald-600 text-white' : 'bg-panel border border-edge text-secondary hover:text-foreground'}`}>
                Custom
            </button>
        </div>
    );
}

export function CustomDurationInputs({ durationMinutes, setDurationMinutes }: { durationMinutes: number; setDurationMinutes: (v: number) => void }) {
    return (
        <div className="flex items-center gap-2 mt-1.5">
            <input type="number" min={0} max={23} value={Math.floor(durationMinutes / 60)}
                onChange={(e) => setDurationMinutes(Number(e.target.value) * 60 + (durationMinutes % 60))}
                className="w-16 bg-panel border border-edge rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-xs text-muted">hr</span>
            <input type="number" min={0} max={59} step={15} value={durationMinutes % 60}
                onChange={(e) => setDurationMinutes(Math.floor(durationMinutes / 60) * 60 + Number(e.target.value))}
                className="w-16 bg-panel border border-edge rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-xs text-muted">min</span>
        </div>
    );
}

export function StartTimeInput({ newStartTime, onStartChange }: { newStartTime: string | null; onStartChange: (v: string) => void }) {
    return (
        <div className="flex-1">
            <label htmlFor="reschedule-start" className="block text-xs text-muted mb-1">New start</label>
            <input id="reschedule-start" type="datetime-local" value={newStartTime ?? ''}
                onChange={(e) => onStartChange(e.target.value)}
                className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
    );
}

export function DurationSelector(props: {
    durationMinutes: number; setDurationMinutes: (v: number) => void;
    customDuration: boolean; setCustomDuration: (v: boolean) => void;
}) {
    return (
        <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Duration</label>
            <DurationPresetButtons {...props} />
            {props.customDuration && <CustomDurationInputs durationMinutes={props.durationMinutes} setDurationMinutes={props.setDurationMinutes} />}
        </div>
    );
}

export function ConfirmationMessage({ eventTitle, isValid, parsedStart, parsedEnd, selectionSummary, signupCount }: {
    eventTitle: string; isValid: boolean; parsedStart: Date | null; parsedEnd: Date | null;
    selectionSummary: string | null; signupCount: number;
}) {
    if (!isValid) {
        return (
            <span className="text-red-400">
                {parsedStart && parsedEnd && parsedStart >= parsedEnd ? 'Start time must be before end time' : 'Start time must be in the future'}
            </span>
        );
    }
    return (
        <>Move <span className="font-semibold">{eventTitle}</span> to{' '}
            <span className="font-semibold text-emerald-400">{selectionSummary}</span>?
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
}) {
    return (
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
            <p className="text-sm text-foreground">
                <ConfirmationMessage eventTitle={eventTitle} isValid={isValid} parsedStart={parsedStart}
                    parsedEnd={parsedEnd} selectionSummary={selectionSummary} signupCount={signupCount} />
            </p>
            <div className="flex gap-2 shrink-0">
                <button onClick={onClear} className="btn btn-secondary btn-sm">Clear</button>
                <button onClick={onConfirm} disabled={isPending || !isValid} className="btn btn-primary btn-sm">
                    {isPending ? 'Rescheduling...' : 'Confirm'}
                </button>
            </div>
        </div>
    );
}

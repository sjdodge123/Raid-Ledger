/**
 * Number stepper for slot counts. Used in both create-event-form and plan-event-form.
 */

function StepperButton({ direction, value, limit, onChange }: {
    direction: 'dec' | 'inc'; value: number; limit: number; onChange: (v: number) => void;
}) {
    const isDec = direction === 'dec';
    const disabled = isDec ? value <= limit : value >= limit;
    const nextValue = isDec ? Math.max(limit, value - 1) : Math.min(limit, value + 1);
    return (
        <button type="button" onClick={() => onChange(nextValue)} disabled={disabled}
            className="w-11 h-11 sm:w-8 sm:h-8 rounded-md bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-lg font-medium">
            {isDec ? '-' : '+'}
        </button>
    );
}

function StepperInput({ value, min, max, onChange }: {
    value: number; min: number; max: number; onChange: (v: number) => void;
}) {
    return (
        <input type="number" min={min} max={max} value={value}
            onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))); }}
            className="w-14 h-11 sm:w-12 sm:h-8 bg-panel border border-edge rounded-md text-foreground text-center text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
    );
}

export function SlotStepper({ label, value, onChange, color, min = 0, max = 99 }: {
    label: string; value: number; onChange: (v: number) => void; color: string; min?: number; max?: number;
}) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 min-h-[44px] sm:min-h-0">
            <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-sm text-secondary font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-1">
                <StepperButton direction="dec" value={value} limit={min} onChange={onChange} />
                <StepperInput value={value} min={min} max={max} onChange={onChange} />
                <StepperButton direction="inc" value={value} limit={max} onChange={onChange} />
            </div>
        </div>
    );
}

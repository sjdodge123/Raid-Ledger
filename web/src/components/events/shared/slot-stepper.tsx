/**
 * Number stepper for slot counts. Used in both create-event-form and plan-event-form.
 *
 * ROK-1649: the -/+ controls are icon-only secondary `Button`s named
 * `Decrease <label>` / `Increase <label>`, natively `disabled` at the bounds;
 * the value is an `Input type="number"` named `<label> slots`. The role dot
 * (`color`) is a categorical role colour and stays raw (forms ruling 9).
 */
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

function StepperButton({ direction, label, value, limit, onChange }: {
    direction: 'dec' | 'inc'; label: string; value: number; limit: number; onChange: (v: number) => void;
}) {
    const isDec = direction === 'dec';
    const disabled = isDec ? value <= limit : value >= limit;
    const nextValue = isDec ? Math.max(limit, value - 1) : Math.min(limit, value + 1);
    return (
        <Button variant="secondary" size="sm" iconOnly aria-label={`${isDec ? 'Decrease' : 'Increase'} ${label}`}
            disabled={disabled} onClick={() => onChange(nextValue)} className="text-lg">
            <span aria-hidden="true">{isDec ? '−' : '+'}</span>
        </Button>
    );
}

function StepperInput({ label, value, min, max, onChange }: {
    label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
    return (
        <div className="w-16">
            <Input type="number" inputMode="numeric" fieldSize="sm" min={min} max={max} value={value}
                aria-label={`${label} slots`} className="text-center"
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))); }} />
        </div>
    );
}

export function SlotStepper({ label, value, onChange, color, min = 0, max = 99 }: {
    label: string; value: number; onChange: (v: number) => void; color: string; min?: number; max?: number;
}) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 min-h-[44px] sm:min-h-0">
            <div className="flex items-center gap-2">
                <div aria-hidden="true" className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-sm text-secondary font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-1">
                <StepperButton direction="dec" label={label} value={value} limit={min} onChange={onChange} />
                <StepperInput label={label} value={value} min={min} max={max} onChange={onChange} />
                <StepperButton direction="inc" label={label} value={value} limit={max} onChange={onChange} />
            </div>
        </div>
    );
}

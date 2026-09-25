/**
 * The shared on/off switch (ROK-1612 review).
 *
 * A native `<button role="switch">`, so Space and Enter toggle it with no key
 * handler of our own and assistive tech reads its state from `aria-checked`.
 * Colours come from the `--color-*` tokens only — `bg-success` on, `bg-dim`
 * off — so every theme remaps it. Disabled dims it and blocks the press.
 */
export interface SwitchProps {
    /** Whether the switch is on. */
    checked: boolean;
    /** Called with the NEW state when pressed. */
    onChange: (checked: boolean) => void;
    /** Accessible name — there is no visible text inside a switch. */
    label: string;
    disabled?: boolean;
    className?: string;
    testId?: string;
    /** Id(s) of visible text that describes the setting (e.g. its row's helper line). */
    'aria-describedby'?: string;
}

const TRACK =
    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
    'disabled:cursor-not-allowed disabled:opacity-50';

const KNOB = 'pointer-events-none inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform';

/** An accessible, token-coloured on/off switch. */
export function Switch({
    checked, onChange, label, disabled = false, className = '', testId, 'aria-describedby': describedBy,
}: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            data-testid={testId}
            onClick={() => onChange(!checked)}
            className={`${TRACK} ${checked ? 'bg-success' : 'bg-dim'} ${disabled ? '' : 'cursor-pointer'} ${className}`}
        >
            <span aria-hidden="true" className={`${KNOB} ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
        </button>
    );
}

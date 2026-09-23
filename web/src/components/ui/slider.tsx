/**
 * Slider — a labelled range with a value readout (ROK-1646, spike ROK-1644
 * §4.8; promotes the `SLIDER_CLS` constant duplicated in
 * `CommonGroundFilters.tsx` and `coop-filter-controls.tsx`).
 *
 * - A native `<input type="range">`, `appearance-none` so the thumb sizing
 *   applies: `flex-1 h-11` (a 44px hit area), a 6px `bg-edge` track filled in
 *   `success` up to the value (`--slider-fill`; Firefox uses `::-moz-range-progress`)
 *   and a 20px `bg-success` thumb. Ref forwarded to the input.
 * - The `<output>` readout is `aria-live="off"`: `aria-valuetext` already speaks it.
 * - Label left (`font-medium`), value right in a `font-mono` `<output for>`.
 * - `formatValue` shapes the readout and becomes `aria-valuetext`
 *   ("40%", "3 players") so a screen reader hears the same thing.
 * - Renders its own label: don't wrap it in `Field`.
 */
import { forwardRef, useId, type ChangeEvent, type CSSProperties, type InputHTMLAttributes } from 'react';
import { DISABLED, FOCUS_RING } from './form-classes';

export interface SliderProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'size'> {
    label: string;
    hideLabel?: boolean;
    value: number;
    onChange: (value: number) => void;
    formatValue?: (value: number) => string;
    /** Show the readout (default true). */
    showValue?: boolean;
    wrapperClassName?: string;
}

const RANGE = [
    'flex-1 min-w-0 h-11 appearance-none accent-success cursor-pointer bg-transparent rounded-lg',
    '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full',
    '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-success)_var(--slider-fill),var(--color-edge)_var(--slider-fill))]',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
    '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-success',
    '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-edge',
    '[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-success',
    '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-success',
    FOCUS_RING, DISABLED,
].join(' ');

/** How far along the track the value sits, as a percentage for `--slider-fill`. */
function fillOf(value: number, min: unknown, max: unknown): string {
    const lo = Number(min ?? 0);
    const hi = Number(max ?? 100);
    return `${hi > lo ? ((value - lo) / (hi - lo)) * 100 : 0}%`;
}

/** A labelled native range with a readout. See the file header for the contract. */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(props, ref) {
    const { label, hideLabel, value, onChange, formatValue, showValue = true, wrapperClassName, className, id, ...rest } = props;
    const generated = useId();
    const inputId = id ?? generated;
    const text = formatValue ? formatValue(value) : String(value);
    const handle = (e: ChangeEvent<HTMLInputElement>): void => onChange(Number(e.target.value));
    return (
        <div className={`flex items-center gap-3 min-h-[44px] ${wrapperClassName ?? ''}`.trim()}>
            <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'shrink-0 text-sm font-medium text-secondary'}>
                {label}
            </label>
            <input
                {...rest} ref={ref} id={inputId} type="range" value={value} onChange={handle}
                aria-valuetext={formatValue ? text : undefined}
                style={{ ...rest.style, '--slider-fill': fillOf(value, rest.min, rest.max) } as CSSProperties}
                className={`${RANGE} ${className ?? ''}`.trim()}
            />
            {showValue && (
                <output htmlFor={inputId} aria-live="off" data-testid="slider-value" className="shrink-0 min-w-[3ch] text-right text-sm font-mono text-foreground">
                    {text}
                </output>
            )}
        </div>
    );
});

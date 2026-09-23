/**
 * Slider — a labelled range with a value readout (ROK-1646, spike ROK-1644
 * §4.8; promotes the `SLIDER_CLS` constant duplicated in
 * `CommonGroundFilters.tsx` and `coop-filter-controls.tsx`).
 *
 * - A native `<input type="range">`: `flex-1 h-11` (a 44px hit area whatever
 *   the painted track), `accent-success` for the thumb and filled track, and
 *   an enlarged 20px webkit thumb. The unfilled track is native chrome and
 *   follows the root `color-scheme` — check both families at the ROOT.
 * - Label left (`font-medium`), value right in a `font-mono` `<output for>`.
 * - `formatValue` shapes the readout and becomes `aria-valuetext`
 *   ("40%", "3 players") so a screen reader hears the same thing.
 * - Renders its own label: don't wrap it in `Field`.
 */
import { useId, type ChangeEvent, type InputHTMLAttributes, type JSX } from 'react';
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
    'flex-1 min-w-0 h-11 accent-success cursor-pointer bg-transparent rounded-lg',
    '[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
    FOCUS_RING, DISABLED,
].join(' ');

/** A labelled native range with a readout. See the file header for the contract. */
export function Slider(props: SliderProps): JSX.Element {
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
                {...rest} id={inputId} type="range" value={value} onChange={handle}
                aria-valuetext={formatValue ? text : undefined}
                className={`${RANGE} ${className ?? ''}`.trim()}
            />
            {showValue && (
                <output htmlFor={inputId} data-testid="slider-value" className="shrink-0 min-w-[3ch] text-right text-sm font-mono text-foreground">
                    {text}
                </output>
            )}
        </div>
    );
}

/**
 * RadioGroup — one choice from a short list (ROK-1646, spike ROK-1644 §4.5).
 *
 * - Native radios sharing one `name` inside a `<fieldset role="radiogroup">`
 *   named by its `<legend>`. The browser supplies the keyboard model: Tab
 *   lands on the checked radio, the arrow keys move AND select.
 * - `appearance="list"` (default): a 44px label row per option — `w-5 h-5
 *   accent-success` radio, label, optional `description` (linked by
 *   `aria-describedby`).
 * - `appearance="segmented"`: the pill toggle (RA-3's 9 sites, and the
 *   duration picker per the operator's ruling). The radio is `sr-only`; the
 *   segment paints ON as `bg-overlay text-foreground`, OFF as `text-muted`, and
 *   carries the focus ring through `has-[:focus-visible]`. Descriptions are
 *   not shown in a segment — keep segment labels short.
 * - Controlled only: `value` + `onChange(value)`.
 * - Validation like the other controls: `invalid`, `error` (an inline
 *   `role="alert"` under the group, linked by `aria-describedby`) and
 *   `aria-describedby`, merged with a surrounding `Field`'s wiring. `aria-invalid`
 *   sits on the `radiogroup`. The ref is forwarded to the `<fieldset>`.
 */
import { forwardRef, useId, type ForwardedRef, type JSX, type ReactNode, type Ref } from 'react';
import { DISABLED, FOCUS_RING } from './form-classes';
import { useFieldControlProps } from './field-context';

export interface RadioOption<V extends string> {
    value: V;
    label: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
    label: string;
    hideLabel?: boolean;
    options: readonly RadioOption<V>[];
    value: V;
    onChange: (value: V) => void;
    appearance?: 'list' | 'segmented';
    /** Shared `name`; generated when omitted. */
    name?: string;
    disabled?: boolean;
    className?: string;
    invalid?: boolean;
    /** Inline error under the group; also marks it invalid. */
    error?: string;
    'aria-describedby'?: string;
}

interface OptionProps<V extends string> {
    option: RadioOption<V>;
    name: string;
    checked: boolean;
    disabled: boolean;
    onChange: (value: V) => void;
    descId: string;
}

const RADIO = `w-5 h-5 shrink-0 accent-success cursor-pointer ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${DISABLED}`;
const SEGMENT = [
    'relative flex flex-1 items-center justify-center min-h-[44px] px-3 rounded-md text-center',
    'text-base lg:text-sm font-medium text-muted cursor-pointer transition-colors hover:text-foreground',
    'has-[:checked]:bg-overlay has-[:checked]:text-foreground',
    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-success/80',
    'has-[:disabled]:opacity-50 has-[:disabled]:cursor-not-allowed',
].join(' ');

function ListOption<V extends string>({ option, name, checked, disabled, onChange, descId }: OptionProps<V>): JSX.Element {
    return (
        <label className="flex items-start gap-3 min-h-[44px] py-2.5 cursor-pointer has-[:disabled]:cursor-not-allowed">
            <input
                type="radio" name={name} value={option.value} checked={checked} disabled={disabled}
                onChange={() => onChange(option.value)} className={RADIO}
                aria-labelledby={`${descId}-label`} aria-describedby={option.description ? descId : undefined}
            />
            <span className="min-w-0">
                <span id={`${descId}-label`} className="block text-base lg:text-sm text-foreground">{option.label}</span>
                {option.description && <span id={descId} className="block text-xs text-muted mt-0.5">{option.description}</span>}
            </span>
        </label>
    );
}

function SegmentOption<V extends string>({ option, name, checked, disabled, onChange }: OptionProps<V>): JSX.Element {
    return (
        <label className={SEGMENT}>
            <input
                type="radio" name={name} value={option.value} checked={checked} disabled={disabled}
                onChange={() => onChange(option.value)} className="sr-only"
            />
            {option.label}
        </label>
    );
}

/** Group-level a11y: own + Field `aria-describedby` / `aria-invalid` / `aria-required`, plus the error id. */
function useGroupA11y<V extends string>(p: RadioGroupProps<V>, errorId: string) {
    const a = useFieldControlProps({
        invalid: p.invalid || !!p.error,
        'aria-describedby': [p['aria-describedby'] ?? '', p.error ? errorId : ''].filter(Boolean).join(' ') || undefined,
    });
    return { 'aria-describedby': a['aria-describedby'], 'aria-invalid': a['aria-invalid'], 'aria-required': a['aria-required'] };
}

function RadioGroupImpl<V extends string>(p: RadioGroupProps<V>, ref: ForwardedRef<HTMLFieldSetElement>): JSX.Element {
    const base = useId();
    const name = p.name ?? `${base}-radio`;
    const segmented = p.appearance === 'segmented';
    const Option = segmented ? SegmentOption : ListOption;
    const a11y = useGroupA11y(p, `${base}-error`);
    const legendCls = p.hideLabel ? 'sr-only' : 'mb-1.5 text-sm font-medium text-secondary';
    const listCls = segmented ? 'flex gap-1 p-1 bg-panel border border-edge rounded-lg' : 'flex flex-col';
    return (
        <fieldset ref={ref} role="radiogroup" aria-labelledby={`${base}-legend`} {...a11y} className={p.className}>
            <legend id={`${base}-legend`} className={legendCls}>{p.label}</legend>
            <div className={listCls}>
                {p.options.map((o, i) => (
                    <Option
                        key={o.value} option={o} name={name} checked={o.value === p.value}
                        disabled={!!(p.disabled || o.disabled)} onChange={p.onChange} descId={`${base}-desc-${i}`}
                    />
                ))}
            </div>
            {p.error && <p id={`${base}-error`} role="alert" className="mt-1 text-sm text-danger">{p.error}</p>}
        </fieldset>
    );
}

/** A labelled group of native radios (ref → the fieldset). See the file header for the contract. */
export const RadioGroup = forwardRef(RadioGroupImpl) as <V extends string>(
    p: RadioGroupProps<V> & { ref?: Ref<HTMLFieldSetElement> },
) => JSX.Element;

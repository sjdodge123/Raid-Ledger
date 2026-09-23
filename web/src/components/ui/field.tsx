/**
 * Field — label + hint + inline error around one form control (ROK-1646,
 * spike ROK-1644 §4.2; operator ruling: validation errors are inline, not
 * toast-only).
 *
 * Generates the control id with `useId()` (or takes `id`), renders
 * `<label htmlFor>`, and passes `id` / `aria-describedby` / `aria-invalid` /
 * `aria-required` to the control through `FieldContext` — see
 * `field-context.ts`. The control must be a primitive that consumes it
 * (`Input` today), or call `useFieldControlProps` itself.
 */
import { useId, useMemo, type JSX, type ReactNode } from 'react';
import { FieldContext, type FieldContextValue } from './field-context';

export interface FieldProps {
    label: string;
    hint?: ReactNode;
    /** Inline validation message. Setting it marks the control invalid. */
    error?: string;
    required?: boolean;
    /** Visually hide the label (search boxes, inline row editors); it still names the control. */
    hideLabel?: boolean;
    id?: string;
    className?: string;
    children: ReactNode;
}

function useFieldValue(p: FieldProps, base: string): FieldContextValue {
    const hintId = `${base}-hint`;
    const errorId = `${base}-error`;
    const describedBy = [p.hint ? hintId : '', p.error ? errorId : ''].filter(Boolean).join(' ') || undefined;
    const invalid = !!p.error;
    const required = !!p.required;
    const value = useMemo(
        () => ({ id: base, labelId: `${base}-label`, describedBy, invalid, required }),
        [base, describedBy, invalid, required],
    );
    return value;
}

function FieldLabel({ htmlFor, label, required, hidden }: {
    htmlFor: string; label: string; required?: boolean; hidden?: boolean;
}): JSX.Element {
    const id = `${htmlFor}-label`;
    const cls = hidden ? 'sr-only' : 'block mb-1.5 text-sm font-medium text-secondary';
    return (
        <label id={id} htmlFor={htmlFor} className={cls}>
            {label}
            {required && <span aria-hidden="true" className="ml-0.5 text-danger">*</span>}
        </label>
    );
}

/** One labelled form control with optional hint and inline error. */
export function Field(props: FieldProps): JSX.Element {
    const generated = useId();
    const base = props.id ?? generated;
    const ctx = useFieldValue(props, base);
    const hintId = `${base}-hint`;
    const errorId = `${base}-error`;
    return (
        <div className={props.className}>
            <FieldLabel htmlFor={base} label={props.label} required={props.required} hidden={props.hideLabel} />
            <FieldContext.Provider value={ctx}>{props.children}</FieldContext.Provider>
            {props.hint && <p id={hintId} className="mt-1 text-xs text-muted">{props.hint}</p>}
            {props.error && <p id={errorId} role="alert" className="mt-1 text-sm text-danger">{props.error}</p>}
        </div>
    );
}

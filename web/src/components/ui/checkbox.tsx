/**
 * Checkbox — the shared native checkbox (ROK-1646, spike ROK-1644 §4.5).
 *
 * - A native `<input type="checkbox">`, `w-5 h-5 accent-success`, with the
 *   shared success focus ring and disabled treatment. Retires the no-op
 *   `text-emerald-500` / `focus:ring-*` idiom (`@tailwindcss/forms` is not
 *   installed) and the hex / dead-token accents.
 * - **Standalone:** pass `label` (and optionally `description`). The whole
 *   `<label>` row is the 44px target; the description is linked by
 *   `aria-describedby`; the name is the label text alone (`aria-labelledby`).
 * - **In a `Field`:** omit `label` — the Field's label, hint, error and
 *   required flag arrive through context. With neither, pass `aria-label`.
 * - `indeterminate` sets the DOM property (there is no attribute), which
 *   exposes the mixed state to assistive tech.
 */
import {
    forwardRef, useEffect, useId, useImperativeHandle, useRef, type ForwardedRef, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { DISABLED, FOCUS_RING } from './form-classes';
import { useFieldControlProps } from './field-context';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    label?: ReactNode;
    description?: ReactNode;
    indeterminate?: boolean;
    invalid?: boolean;
}

const BOX = `w-5 h-5 shrink-0 accent-success cursor-pointer rounded ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${DISABLED}`;

/** Keep `indeterminate` on the DOM node and expose the node through the caller's ref. */
function useIndeterminateRef(indeterminate: boolean, forwarded: ForwardedRef<HTMLInputElement>) {
    const local = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwarded, () => local.current as HTMLInputElement, []);
    useEffect(() => {
        if (local.current) local.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return local;
}

/** The shared checkbox. See the file header for the contract. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(props, ref) {
    const { label, description, indeterminate, invalid, className, id,
        'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest } = props;
    const uid = useId();
    const descId = `${uid}-desc`;
    const setRef = useIndeterminateRef(!!indeterminate, ref);
    const a11y = useFieldControlProps({
        id, invalid, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired,
        'aria-describedby': [description ? descId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined,
    });
    const labelledBy = label === undefined ? undefined : `${uid}-label`;
    const box = <input ref={setRef} type="checkbox" aria-labelledby={labelledBy} {...rest} {...a11y} className={`${BOX} ${className ?? ''}`.trim()} />;
    if (label === undefined) return box;
    return (
        <label className="flex items-start gap-3 min-h-[44px] py-2.5 cursor-pointer has-[:disabled]:cursor-not-allowed">
            <span className="flex items-center h-5">{box}</span>
            <span className="min-w-0">
                <span id={labelledBy} className="block text-base lg:text-sm text-foreground">{label}</span>
                {description && <span id={descId} className="block text-xs text-muted mt-0.5">{description}</span>}
            </span>
        </label>
    );
});

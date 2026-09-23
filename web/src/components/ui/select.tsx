/**
 * Select — the shared native select (ROK-1646, spike ROK-1644 §4.4).
 *
 * - Stays a native `<select>` (all 26 audited sites are native): the frame is
 *   `FIELD_FRAME_BASE` + `FIELD_PAD[fieldSize]` + `appearance-none pr-9`, with a
 *   decorative chevron in `text-muted` where the browser arrow was.
 * - `fieldSize`, not `size` — the native `size` attribute turns a select into a
 *   list box.
 * - `placeholder` renders a first `<option value="">`; pair it with
 *   `value=""`/`defaultValue=""` so it shows before a choice is made.
 * - Inside a `Field` it takes `id` / `aria-describedby` / `aria-invalid` /
 *   `aria-required` from context (`useFieldControlProps`).
 * - `className` styles the select; `wrapperClassName` sizes the wrapper that
 *   holds the chevron (default `w-full`).
 */
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { FIELD_FRAME_BASE, FIELD_PAD, type FieldSize } from './form-classes';
import { useFieldControlProps } from './field-context';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    invalid?: boolean;
    fieldSize?: FieldSize;
    /** Text of an empty-value first option. */
    placeholder?: string;
    wrapperClassName?: string;
}

function selectClass(fieldSize: FieldSize, className?: string): string {
    return [FIELD_FRAME_BASE, FIELD_PAD[fieldSize], 'appearance-none pr-9 cursor-pointer', className ?? '']
        .filter(Boolean).join(' ');
}

/** The shared native select. See the file header for the contract. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
    const { invalid, fieldSize, placeholder, wrapperClassName, className, children, id,
        'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest } = props;
    const a11y = useFieldControlProps({
        id, invalid, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired,
    });
    return (
        <div className={`relative ${wrapperClassName ?? 'w-full'}`}>
            <select ref={ref} {...rest} {...a11y} className={selectClass(fieldSize ?? 'md', className)}>
                {placeholder !== undefined && <option value="">{placeholder}</option>}
                {children}
            </select>
            <ChevronDownIcon
                data-testid="select-chevron"
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            />
        </div>
    );
});

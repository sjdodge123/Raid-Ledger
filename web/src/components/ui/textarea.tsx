/**
 * Textarea — the shared multi-line field (ROK-1646, spike ROK-1644 §4.4).
 *
 * - The frame is `FIELD_FRAME` (tokens, `rounded-lg`, success focus ring,
 *   `text-base` below `lg`). The 44px floor stays: it is a no-op at 2+ rows and
 *   keeps a 1-row textarea a real touch target.
 * - Every native attribute passes through (`value`, `onChange`, `rows`,
 *   `maxLength`, `name`, `disabled`), and the ref is forwarded.
 * - `showCount` + `maxLength` renders a `n/max` counter (`text-xs text-dim`)
 *   under the box, always, and adds it to `aria-describedby`. It is NOT live:
 *   a separate `sr-only` polite region says "N characters left" only near the
 *   limit (the last 10% of `maxLength`, at most 20 characters).
 * - `fieldSize` (`md` default / `lg` / `sm`) swaps the padding, as on `Input`.
 *   It counts `value` when controlled, and tracks input itself when not.
 * - `resize`: `'y'` (default) or `'none'`.
 * - Inside a `Field` it takes the id / describedby / invalid / required wiring.
 */
import {
    forwardRef, useId, useState, type ChangeEvent, type TextareaHTMLAttributes,
} from 'react';
import { FIELD_FRAME_BASE, FIELD_PAD, type FieldSize } from './form-classes';
import { useFieldControlProps } from './field-context';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
    /** Show an `n/maxLength` counter. Needs `maxLength`. */
    showCount?: boolean;
    resize?: 'none' | 'y';
    fieldSize?: FieldSize;
}

/** "N characters left" once within the last 10% of the limit (capped at 20); else silent. */
function nearLimitText(length: number, max: number): string {
    const left = max - length;
    return left <= Math.min(20, Math.ceil(max * 0.1)) ? `${left} characters left` : '';
}

/** Current length: the controlled value when there is one, else what the user typed. */
function useLength(p: Pick<TextareaProps, 'value' | 'defaultValue' | 'onChange'>) {
    const [typed, setTyped] = useState(() => String(p.defaultValue ?? '').length);
    const onChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
        setTyped(e.target.value.length);
        p.onChange?.(e);
    };
    const length = p.value !== undefined ? String(p.value).length : typed;
    return { length, onChange };
}

/** The shared textarea. See the file header for the contract. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(props, ref) {
    const { invalid, showCount, resize, fieldSize, className, id, onChange, maxLength,
        'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest } = props;
    const countId = `${useId()}-count`;
    const counted = !!showCount && maxLength !== undefined;
    const { length, onChange: handleChange } = useLength({ value: rest.value, defaultValue: rest.defaultValue, onChange });
    const a11y = useFieldControlProps({
        id, invalid, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired,
        'aria-describedby': [counted ? countId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined,
    });
    const cls = [FIELD_FRAME_BASE, FIELD_PAD[fieldSize ?? 'md'], resize === 'none' ? 'resize-none' : 'resize-y', className ?? ''].filter(Boolean).join(' ');
    const box = <textarea ref={ref} {...rest} {...a11y} maxLength={maxLength} onChange={handleChange} className={cls} />;
    if (!counted) return box;
    return (
        <div className="w-full">
            {box}
            <p id={countId} data-testid="textarea-count" className="mt-1 text-right text-xs text-dim">
                {length}/{maxLength}
            </p>
            <span data-testid="textarea-count-live" aria-live="polite" className="sr-only">{nearLimitText(length, maxLength)}</span>
        </div>
    );
});

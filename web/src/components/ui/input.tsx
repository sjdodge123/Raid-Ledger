/**
 * Input — the shared text input (ROK-1646, spike ROK-1644 §4.3).
 *
 * - The frame is `FIELD_FRAME_BASE` + `FIELD_PAD[fieldSize]` from
 *   `form-classes.ts`: tokens only, 44px minimum, `text-base` below `lg` (stops
 *   iOS Safari zooming on focus), `rounded-lg`, focus-visible ring on `success`.
 * - `fieldSize`, not `size`: the native `size?: number` attribute would clash.
 * - Inside a `Field` it picks up `id`, `aria-describedby`, `aria-invalid` and
 *   `aria-required` from context (`useFieldControlProps`).
 * - `leading` is a decorative icon slot (pointer-events off, `text-muted`);
 *   `trailing` is interactive (a show/hide or copy button). A bare input
 *   renders no wrapper, so it drops into flex rows unchanged.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { FIELD_FRAME_BASE, FIELD_PAD, type FieldSize } from './form-classes';
import { useFieldControlProps } from './field-context';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    invalid?: boolean;
    fieldSize?: FieldSize;
    leading?: ReactNode;
    trailing?: ReactNode;
    /** Monospace text — ids, codes, URLs, numeric readouts. */
    mono?: boolean;
}

function inputClass(p: Pick<InputProps, 'fieldSize' | 'leading' | 'trailing' | 'mono' | 'className'>): string {
    return [
        FIELD_FRAME_BASE,
        FIELD_PAD[p.fieldSize ?? 'md'],
        p.leading ? 'pl-10' : '',
        p.trailing ? 'pr-14' : '',
        p.mono ? 'font-mono' : '',
        p.className ?? '',
    ].filter(Boolean).join(' ');
}

function Adorned({ leading, trailing, children }: {
    leading?: ReactNode; trailing?: ReactNode; children: ReactNode;
}): ReactNode {
    return (
        <div className="relative w-full">
            {leading && (
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
                    {leading}
                </span>
            )}
            {children}
            {trailing && <span className="absolute inset-y-0 right-0 flex items-center">{trailing}</span>}
        </div>
    );
}

/** The shared text input. See the file header for the contract. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
    const { invalid, fieldSize, leading, trailing, mono, className, id,
        'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, ...rest } = props;
    const a11y = useFieldControlProps({
        id, invalid, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired,
    });
    const input = (
        <input ref={ref} {...rest} {...a11y} className={inputClass({ fieldSize, leading, trailing, mono, className })} />
    );
    if (!leading && !trailing) return input;
    return <Adorned leading={leading} trailing={trailing}>{input}</Adorned>;
});

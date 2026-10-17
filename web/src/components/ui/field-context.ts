/**
 * Field → control wiring (ROK-1646, spike ROK-1644 §4.2).
 *
 * `Field` provides this context; every form control (Input now; Select,
 * Textarea, Checkbox, SearchInput next) calls {@link useFieldControlProps} and
 * spreads the result onto its native element. Context rather than
 * `cloneElement` so a control nested inside wrapper markup still gets wired.
 * Kept out of `field.tsx` so that file exports components only (react-refresh).
 */
import { createContext, useContext } from 'react';

export interface FieldContextValue {
    /** The control's id — `<label htmlFor>` points at it. */
    id: string;
    /** The `<label>`'s id — for a popup (Combobox listbox) that must share the name. */
    labelId: string;
    /** Space-separated ids of the hint and error, when rendered. */
    describedBy?: string;
    invalid: boolean;
    required: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding Field's wiring, or null outside a Field. */
export function useFieldContext(): FieldContextValue | null {
    return useContext(FieldContext);
}

/**
 * Props a control may already carry that the Field merges with. Each is
 * `| undefined` like React's own DOM attribute types: a control forwards its
 * destructured props here whether or not the caller set them.
 */
export interface FieldControlOwnProps {
    id?: string | undefined;
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
    'aria-required'?: boolean | 'true' | 'false' | undefined;
    /** The primitive's own `invalid` prop. */
    invalid?: boolean | undefined;
}

/** Spread onto the native element; an undefined attribute is not rendered, as in React's own types. */
export interface FieldControlA11yProps {
    id?: string | undefined;
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: true | undefined;
    'aria-required'?: true | undefined;
}

function joinIds(...ids: (string | undefined)[]): string | undefined {
    const joined = ids.filter(Boolean).join(' ');
    return joined === '' ? undefined : joined;
}

function isTrue(v: FieldControlOwnProps['aria-invalid'] | boolean | undefined): boolean {
    return v === true || v === 'true';
}

/**
 * Merge a control's own a11y props with the surrounding Field's. An explicit
 * `id` on the control wins; describedby ids are concatenated; invalid /
 * required are true if either side says so.
 */
export function useFieldControlProps(own: FieldControlOwnProps): FieldControlA11yProps {
    const field = useFieldContext();
    const invalid = isTrue(own.invalid) || isTrue(own['aria-invalid']) || !!field?.invalid;
    const required = isTrue(own['aria-required']) || !!field?.required;
    return {
        id: own.id ?? field?.id,
        'aria-describedby': joinIds(own['aria-describedby'], field?.describedBy),
        'aria-invalid': invalid ? true : undefined,
        'aria-required': required ? true : undefined,
    };
}

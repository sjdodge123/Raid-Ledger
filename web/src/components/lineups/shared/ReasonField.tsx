/**
 * Shared optional-reason textarea for destructive lineup modals (ROK-1219).
 * Extracted from AbortLineupModal (ROK-1062) so the cancel-poll modal reuses
 * the same 500-char field + live counter without forking it. ROK-1650 moved it
 * onto Field + Textarea `showCount`; the public API is unchanged.
 */
import type { JSX } from 'react';
import { Field } from '../../ui/field';
import { Textarea } from '../../ui/textarea';

export const REASON_MAX = 500;

interface ReasonFieldProps {
    /** DOM id linking the label to the textarea. */
    id: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}

/** Optional reason on the shared Field + Textarea (counter and success focus ring, ruling 11). */
export function ReasonField({
    id,
    value,
    onChange,
    placeholder,
}: ReasonFieldProps): JSX.Element {
    return (
        <Field label="Reason (optional)" id={id}>
            <Textarea
                rows={4}
                showCount
                maxLength={REASON_MAX}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
        </Field>
    );
}

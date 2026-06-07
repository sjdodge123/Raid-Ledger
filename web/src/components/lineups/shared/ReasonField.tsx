/**
 * Shared optional-reason textarea for destructive lineup modals (ROK-1219).
 * Extracted from AbortLineupModal (ROK-1062) so the cancel-poll modal reuses
 * the same 500-char field + live counter without forking it.
 */
import type { JSX } from 'react';

export const REASON_MAX = 500;

interface ReasonFieldProps {
    /** DOM id linking the label to the textarea. */
    id: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}

export function ReasonField({
    id,
    value,
    onChange,
    placeholder,
}: ReasonFieldProps): JSX.Element {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label
                    htmlFor={id}
                    className="block text-sm font-medium text-secondary"
                >
                    Reason <span className="text-dim font-normal">(optional)</span>
                </label>
                <span className="text-xs text-muted tabular-nums">
                    {value.length} / {REASON_MAX}
                </span>
            </div>
            <textarea
                id={id}
                rows={4}
                maxLength={REASON_MAX}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
        </div>
    );
}

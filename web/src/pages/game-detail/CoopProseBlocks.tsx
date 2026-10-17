import { useState, type JSX } from 'react';
import type { CooptimusExtrasDto } from '@raid-ledger/contract';

/**
 * Co-Optimus editorial prose blocks (ROK-1398).
 *
 * Rendered purely on FIELD PRESENCE — the permission flag is enforced
 * server-side (`cooptimusProseEnabled`), so when the operator has not opted in
 * the API simply omits these keys and nothing here renders. Empty strings are
 * treated as absent so a blank upstream field never leaves a layout hole.
 */

/** Trim to null so `""` / whitespace-only prose counts as absent. */
function nonEmpty(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function CoopProseBlocks({ extras }: {
    extras: CooptimusExtrasDto | null | undefined;
}): JSX.Element | null {
    const experience = nonEmpty(extras?.coopExperience);
    const description = nonEmpty(extras?.description);
    if (!experience && !description) return null;

    return (
        <div className="space-y-4 mt-4">
            {experience && (
                <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">The Co-Op Experience</h3>
                    <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">{experience}</p>
                </div>
            )}
            {description && <CooptimusDescription text={description} />}
        </div>
    );
}

/** Their game description — clamped by default (IGDB's summary already sits in the banner). */
function CooptimusDescription({ text }: { text: string }): JSX.Element {
    const [expanded, setExpanded] = useState(false);
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">From Co-Optimus</h3>
            <p className={`text-sm text-secondary leading-relaxed ${expanded ? '' : 'line-clamp-4'}`}>{text}</p>
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors bg-transparent border-none cursor-pointer p-0"
            >
                {expanded ? 'Show less' : 'Show more'}
            </button>
        </div>
    );
}

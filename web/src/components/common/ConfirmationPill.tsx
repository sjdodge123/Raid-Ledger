/**
 * Shared confirmation pill (ROK-1209). Three variants:
 *   - 'text': "✓ Your nomination"
 *   - 'count': "✓ Voted (2/3 votes used)"
 *   - 'waitingOnN': "✓ You've voted · waiting on 4 others"
 */
import type { JSX, ReactNode } from 'react';

type Variant = 'text' | 'count' | 'waitingOnN';
type Tone = 'success' | 'danger' | 'info';

interface Props {
    variant: Variant;
    children: ReactNode;
    count?: number | string;
    tone?: Tone;
    size?: 'sm' | 'md';
    'aria-label'?: string;
}

const TONE_CLS: Record<Tone, string> = {
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    danger: 'bg-red-500/15 text-red-300 border-red-500/40',
    info: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

function inferLabel(variant: Variant, children: ReactNode, count?: number | string): string {
    const base = typeof children === 'string' ? children : 'Action complete';
    if (variant === 'waitingOnN') return `${base} — waiting on ${count} others`;
    if (variant === 'count') return `${base} (${count})`;
    return base;
}

export function ConfirmationPill(props: Props): JSX.Element {
    const { variant, children, count, tone = 'success', size = 'md' } = props;
    const ariaLabel = props['aria-label'] ?? inferLabel(variant, children, count);
    const sizeCls = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
    return (
        <span
            data-testid="confirmation-pill"
            data-tone={tone}
            aria-label={ariaLabel}
            className={`inline-flex items-center gap-1.5 ${sizeCls} font-medium rounded-full border ${TONE_CLS[tone]}`}
        >
            <span aria-hidden="true">✓</span>
            <span>{children}</span>
            {variant === 'count' && count != null && (
                <span className="text-dim">· {count}</span>
            )}
            {variant === 'waitingOnN' && count != null && (
                <span className="text-dim">· waiting on {count} others</span>
            )}
        </span>
    );
}

/**
 * Read-only status chip — the §4.21 recipe (docs/design-system.md), tokens only.
 * Extracted from the Pelican admin state chip (ROK-1776) so member-facing and
 * admin surfaces share one implementation instead of copying the tone classes.
 */
import type { ReactNode } from 'react';

export type StatusChipTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONE_CLS: Record<StatusChipTone, string> = {
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    danger: 'bg-danger/10 border-danger/30 text-danger',
    neutral: 'bg-panel border-edge text-muted',
};

export type StatusChipSize = 'sm' | 'md';

/** `sm` (default) is the dense table/row chip; `md` is for touch-sized rows (the phone hubs sheet). */
const SIZE_CLS: Record<StatusChipSize, string> = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
};

export interface StatusChipProps {
    tone: StatusChipTone;
    /** Required: the chip's colour must never be its only signal. */
    title: string;
    children: ReactNode;
    className?: string;
    size?: StatusChipSize;
}

export function StatusChip({ tone, title, children, className, size = 'sm' }: StatusChipProps) {
    const extra = className ? ` ${className}` : '';
    return (
        <span data-tone={tone} title={title}
            className={`inline-flex items-center whitespace-nowrap rounded-full border ${SIZE_CLS[size]} font-mono ${TONE_CLS[tone]}${extra}`}>
            {children}
        </span>
    );
}

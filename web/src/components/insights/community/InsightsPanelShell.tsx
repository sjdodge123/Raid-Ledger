import type { ReactNode } from 'react';
import { isNoSnapshotYet } from '../../../hooks/use-community-insights';

interface PanelStatus {
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    data: unknown;
}

interface Props {
    testid: string;
    title: string;
    status: PanelStatus;
    emptyHint?: string;
    children?: ReactNode;
    actions?: ReactNode;
}

/**
 * Shared panel chrome for the Community Insights grid. Owns the outer
 * `<section>`, the title, and the loading/error/no-snapshot states so
 * individual panels only render content when data is ready.
 */
export function InsightsPanelShell({ testid, title, status, emptyHint, children, actions }: Props) {
    return (
        <section
            data-testid={testid}
            className="bg-panel/50 rounded-xl border border-edge/50 p-6"
        >
            <header className="flex items-start justify-between gap-4 mb-4">
                <h2 className="text-xl font-semibold text-foreground">{title}</h2>
                {actions}
            </header>
            {status.isLoading && <SkeletonLine />}
            {status.isError && !isNoSnapshotYet(status.error) && (
                <p className="text-sm text-red-400">Failed to load: {status.error?.message ?? 'unknown error'}</p>
            )}
            {status.isError && isNoSnapshotYet(status.error) && (
                <p className="text-sm text-muted">{emptyHint ?? 'No snapshot yet.'}</p>
            )}
            {status.data != null && children}
        </section>
    );
}

function SkeletonLine() {
    return (
        <div className="animate-pulse space-y-2">
            <div className="h-4 bg-overlay rounded w-1/3" />
            <div className="h-32 bg-overlay rounded" />
        </div>
    );
}

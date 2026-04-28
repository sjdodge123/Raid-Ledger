import type { SlowQueryDigestDto, SlowQueryEntryDto } from '@raid-ledger/contract';
import { useSlowQueriesDigest, useCaptureSlowQuerySnapshot, type SlowQueriesResponse } from '../../hooks/use-slow-queries';

/**
 * Admin card surfacing the latest slow-query digest (ROK-1156).
 *
 * Mounted on the admin Logs page. Displays the top 10 entries from the most
 * recent snapshot diffed against the most recent cron snapshot, plus a button
 * to capture a fresh on-demand snapshot.
 */
export function SlowQueriesCard() {
    const digest = useSlowQueriesDigest();
    const capture = useCaptureSlowQuerySnapshot();
    const capturedAt = hasDigest(digest.data) ? digest.data.snapshot.capturedAt : null;

    return (
        <section className="border border-edge rounded-xl p-5 bg-surface/30 space-y-4">
            <SlowQueriesHeader
                capturedAt={capturedAt}
                onRefresh={() => capture.mutate()}
                isRefreshing={capture.isPending}
            />
            <SlowQueriesBody
                isLoading={digest.isLoading}
                isError={digest.isError}
                data={digest.data}
            />
        </section>
    );
}

function hasDigest(data: SlowQueriesResponse | undefined): data is SlowQueryDigestDto {
    return data?.snapshot != null;
}

function SlowQueriesHeader({
    capturedAt,
    onRefresh,
    isRefreshing,
}: {
    capturedAt: string | null;
    onRefresh: () => void;
    isRefreshing: boolean;
}) {
    return (
        <div className="flex items-start justify-between gap-3">
            <SlowQueriesTitle capturedAt={capturedAt} />
            <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </div>
    );
}

function SlowQueriesTitle({ capturedAt }: { capturedAt: string | null }) {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">Slow Queries</h2>
            {capturedAt ? (
                <p className="text-xs text-muted mt-1">
                    Last captured: {formatCapturedAt(capturedAt)}
                </p>
            ) : (
                <p className="text-sm text-muted mt-1">
                    Top queries by mean execution time over the last cron window.
                </p>
            )}
        </div>
    );
}

function RefreshButton({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
    return (
        <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh now"
            className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
            {isRefreshing ? 'Refreshing...' : 'Refresh now'}
        </button>
    );
}

function SlowQueriesBody({
    isLoading,
    isError,
    data,
}: {
    isLoading: boolean;
    isError: boolean;
    data: SlowQueriesResponse | undefined;
}) {
    if (isLoading) {
        return <div className="py-8 text-center text-muted text-sm">Loading slow queries...</div>;
    }
    if (isError) {
        return (
            <div className="py-8 text-center text-red-400 text-sm">
                Failed to load slow queries. Please try again.
            </div>
        );
    }
    if (!hasDigest(data)) {
        return (
            <div className="py-8 text-center text-muted text-sm">
                No baseline yet — run a snapshot to start tracking.
            </div>
        );
    }
    return <SlowQueriesTable entries={data.entries} />;
}

function SlowQueriesTable({ entries }: { entries: SlowQueryEntryDto[] }) {
    return (
        <div className="border border-edge rounded-lg overflow-hidden">
            <table className="w-full text-sm">
                <caption className="sr-only">
                    Slow queries ranked by mean execution time
                </caption>
                <SlowQueriesTableHeader />
                <tbody className="divide-y divide-edge">
                    {entries.map((entry) => (
                        <SlowQueryRow key={entry.queryid} entry={entry} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SlowQueriesTableHeader() {
    return (
        <thead>
            <tr className="border-b border-edge bg-surface/50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider">
                    Query
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider w-20">
                    Calls
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider w-24">
                    Mean (ms)
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider w-24">
                    Total (ms)
                </th>
            </tr>
        </thead>
    );
}

function SlowQueryRow({ entry }: { entry: SlowQueryEntryDto }) {
    return (
        <tr className="hover:bg-surface/30 transition-colors">
            <td className="px-4 py-2 max-w-0">
                <code
                    className="block font-mono text-xs text-foreground truncate"
                    title={entry.queryText}
                >
                    {entry.queryText}
                </code>
            </td>
            <td className="px-4 py-2 text-right text-muted tabular-nums">
                {formatNumber(entry.calls)}
            </td>
            <td className="px-4 py-2 text-right text-muted tabular-nums">
                {formatMs(entry.meanExecTimeMs)}
            </td>
            <td className="px-4 py-2 text-right text-muted tabular-nums">
                {formatMs(entry.totalExecTimeMs)}
            </td>
        </tr>
    );
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatMs(value: number): string {
    return value >= 100
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
        : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatCapturedAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

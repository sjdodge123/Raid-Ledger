/**
 * `/gg/archive` — every year the player has a GG for (R5); each opens its own
 * frozen snapshot. `/gg` redirects to the newest year.
 */
import type { JSX } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useGgArchive } from '../../hooks/use-gg';
import { LoadingSpinner } from '../../components/ui/loading-spinner';
import { GgEmptyState } from './gg-year-page';

/** The archive list. */
export function GgArchivePage(): JSX.Element {
    const { data, isLoading } = useGgArchive();
    if (isLoading) return <LoadingSpinner />;
    const years = data?.years ?? [];
    if (years.length === 0) return <GgEmptyState year={null} />;
    return (
        <div className="mx-auto max-w-md px-4 py-8">
            <h1 className="mb-4 text-2xl font-bold text-foreground">Your GG years</h1>
            <ul className="flex flex-col gap-2">
                {years.map((y) => (
                    <li key={y.year}>
                        <Link to={`/gg/${y.year}`} className="flex items-center justify-between rounded-xl border border-edge bg-panel px-4 py-3 hover:bg-overlay">
                            <span className="text-lg font-semibold text-foreground">GG {y.year}</span>
                            <span className="text-xs text-muted">{y.shared ? 'Shared' : 'Private'}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** `/gg` → the newest year, or the empty state. */
export function GgLatestRedirect(): JSX.Element {
    const { data, isLoading } = useGgArchive();
    if (isLoading) return <LoadingSpinner />;
    const newest = data?.years[0]?.year;
    return newest ? <Navigate to={`/gg/${newest}`} replace /> : <GgEmptyState year={null} />;
}

export default GgArchivePage;

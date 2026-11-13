/**
 * `/w/:slug` — a shared GG, the Summary card only (Q4). Anonymous; the DTO
 * carries no other players' names (a count only), ids or email.
 */
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import { useGgPublic } from '../../hooks/use-gg';
import { LoadingSpinner } from '../../components/ui/loading-spinner';
import { GgSummaryFace } from '../../components/gg/gg-summary-face';

/** The route element. */
export function GgPublicPage(): JSX.Element {
    const { slug } = useParams();
    const { data, isLoading, isError } = useGgPublic(slug);
    if (isLoading) return <LoadingSpinner />;
    if (isError || !data) {
        return <p className="px-4 py-16 text-center text-secondary" data-testid="gg-public-missing">This GG isn&apos;t shared any more.</p>;
    }
    return (
        <main className="flex min-h-screen items-center justify-center bg-backdrop p-4">
            <article className="flex aspect-[9/16] w-full max-w-sm flex-col gap-3 overflow-hidden rounded-3xl border border-edge bg-surface px-6 py-10">
                {data.avatarUrl && <img src={data.avatarUrl} alt="" className="h-16 w-16 rounded-full" />}
                <GgSummaryFace year={data.year} displayName={data.displayName} eventsAttended={data.eventsAttended}
                    hoursPlayedSeconds={data.hoursPlayedSeconds} topGames={data.topGames}
                    playedWithCount={data.playedWithCount} superlative={data.superlative} />
                <div className="flex-1" />
                <p className="text-xs text-dim">Made with Raid Ledger</p>
            </article>
        </main>
    );
}

export default GgPublicPage;

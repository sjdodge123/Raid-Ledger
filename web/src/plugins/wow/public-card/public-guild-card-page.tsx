/**
 * ROK-1813 — `/p/guild/:slug`, the signed-out guild visitor card. Mounted by
 * core `app-routes.tsx` through a lazy entry (design-system "core lazy route →
 * plugin page"); outside `AuthGuard` and the app chrome, like `/p/lineup` and
 * `/w`. Off, unknown, malformed and hidden all read the same not-found (D2).
 */
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import { LoadingSpinner } from '../../../components/ui/loading-spinner';
import { useNoIndex } from '../../../hooks/use-noindex';
import { PublicGuildCardView } from './public-guild-card';
import { isPublicGuildCardSlug, usePublicGuildCard } from './use-public-guild-card';

function NotFound(): JSX.Element {
    return (
        <div data-testid="public-guild-card-not-found"
            className="mx-auto max-w-[560px] rounded-lg border border-edge bg-surface px-5 py-8 text-center">
            <p className="text-muted">This page doesn&apos;t exist. Check the link and try again.</p>
        </div>
    );
}

function PageBody({ slug }: { slug: string | undefined }): JSX.Element {
    const { data, isLoading, isError } = usePublicGuildCard(slug);
    if (!isPublicGuildCardSlug(slug) || isError) return <NotFound />;
    if (isLoading || !data) return <LoadingSpinner />;
    return <PublicGuildCardView card={data} />;
}

/** The route element. */
export function PublicGuildCardPage(): JSX.Element {
    useNoIndex();
    const { slug } = useParams();
    return (
        <main className="min-h-screen bg-backdrop px-4 pb-16 pt-6">
            <div className="mx-auto max-w-[560px]">
                <p className="mb-3 text-xs text-dim">Raid Ledger</p>
                <PageBody slug={slug} />
            </div>
        </main>
    );
}

export default PublicGuildCardPage;

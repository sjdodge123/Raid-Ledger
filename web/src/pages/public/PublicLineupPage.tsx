/**
 * Public lineup page (ROK-1067).
 *
 * Renders an un-authed, chrome-less view of a community lineup. Reachable
 * at `/p/lineup/:slug`. The route is registered OUTSIDE the AuthGuard so
 * the page never redirects to /login — a 404 from the API yields a
 * fallback UI instead.
 *
 * Intentionally narrow: title, optional markdown description, status
 * badge, decision block (only when status === 'decided'), and a "Made
 * with Raid Ledger" footer. No vote counts, no nominees, no invitees —
 * the API enforces this; the page just renders what it gets.
 */
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import { usePublicLineup } from '../../hooks/use-lineups';
import { MarkdownText } from '../../components/ui/markdown-text';

const STATUS_LABELS = {
    building: 'Building',
    voting: 'Voting',
    decided: 'Decided',
    archived: 'Archived',
} as const;

const STATUS_CLASSES = {
    building: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    voting: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    decided: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    archived: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
} as const;

function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
    return (
        <span
            data-testid="public-lineup-status-badge"
            className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border ${STATUS_CLASSES[status]}`}
        >
            {STATUS_LABELS[status]}
        </span>
    );
}

function Footer() {
    return (
        <footer className="mt-8 pt-4 border-t border-edge/40 text-center text-sm text-muted">
            <a
                href="/"
                className="text-emerald-400 hover:text-emerald-300 underline"
            >
                Made with Raid Ledger
            </a>
        </footer>
    );
}

interface DecisionBlockProps {
    gameName: string;
    coverUrl: string | null;
}

function DecisionBlock({ gameName, coverUrl }: DecisionBlockProps) {
    return (
        <section
            data-testid="public-lineup-decision"
            className="mt-6 p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5"
        >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-400 mb-2">
                Winning game
            </h2>
            <div className="flex items-center gap-3">
                {coverUrl && (
                    <img
                        src={coverUrl}
                        alt={`${gameName} cover art`}
                        className="w-16 h-auto rounded shadow"
                        loading="lazy"
                    />
                )}
                <span className="text-lg font-display font-bold">
                    {gameName}
                </span>
            </div>
        </section>
    );
}

function NotFoundPanel() {
    return (
        <main className="min-h-dvh flex items-center justify-center px-4 bg-bg text-foreground">
            <div className="max-w-lg w-full text-center">
                <h1 className="text-2xl font-display font-bold mb-3">
                    This lineup is no longer available
                </h1>
                <p className="text-muted">
                    The link may be expired, disabled, or you may have
                    mistyped the URL.
                </p>
                <Footer />
            </div>
        </main>
    );
}

function ErrorPanel() {
    return (
        <main
            data-testid="public-lineup-error"
            className="min-h-dvh flex items-center justify-center px-4 bg-bg text-foreground"
        >
            <div className="max-w-lg w-full text-center">
                <h1 className="text-2xl font-display font-bold mb-3">
                    Something went wrong
                </h1>
                <p className="text-muted mb-4">
                    We couldn't load this lineup right now. Please try again
                    in a moment.
                </p>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="text-emerald-400 hover:text-emerald-300 underline"
                >
                    Reload
                </button>
                <Footer />
            </div>
        </main>
    );
}

function LoadingPanel() {
    return (
        <main className="min-h-dvh flex items-center justify-center px-4 bg-bg text-foreground">
            <p className="text-muted">Loading…</p>
        </main>
    );
}

export function PublicLineupPage(): JSX.Element {
    const { slug } = useParams<{ slug: string }>();
    const { data, isLoading, error } = usePublicLineup(slug);

    if (error?.status === 404) return <NotFoundPanel />;
    if (error) return <ErrorPanel />;
    if (isLoading) return <LoadingPanel />;
    if (!data) return <NotFoundPanel />;

    return (
        <main className="min-h-dvh px-4 py-8 bg-bg text-foreground">
            <article className="max-w-2xl mx-auto">
                <header className="mb-4">
                    <div className="flex items-center gap-3 flex-wrap mb-3">
                        <StatusBadge status={data.status} />
                        <span className="text-sm text-muted">
                            {data.communityName}
                        </span>
                    </div>
                    <h1 className="text-3xl font-display font-bold tracking-wide">
                        {data.title}
                    </h1>
                </header>
                {data.description && (
                    <div className="mt-2 text-base leading-relaxed">
                        <MarkdownText text={data.description} />
                    </div>
                )}
                {data.status === 'decided' && data.decision && (
                    <DecisionBlock
                        gameName={data.decision.gameName}
                        coverUrl={data.decision.coverUrl}
                    />
                )}
                <Footer />
            </article>
        </main>
    );
}

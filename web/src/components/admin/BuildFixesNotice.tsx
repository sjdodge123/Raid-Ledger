import { useUpdateStatus } from '../../hooks/use-version';

/** §4.12 inline count pill — indigo tint, remapped for the light family. */
const PILL_CLS = 'px-2 py-0.5 text-xs rounded-full bg-indigo-500/10 text-indigo-400 font-medium';

function versionLabel(v: string): string {
    return /^\d/.test(v) ? `v${v}` : v;
}

function FixesPill({ count, href }: { count: number; href: string | null }) {
    const label = `${count} ${count === 1 ? 'fix' : 'fixes'} available`;
    if (!href) return <span className={PILL_CLS} data-testid="fixes-pill">{label}</span>;
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" data-testid="fixes-pill"
            className={`${PILL_CLS} hover:underline underline-offset-2`}>
            {label}
        </a>
    );
}

function FixesClause({ count, href }: { count: number | null; href: string | null }) {
    // null = unknown (air-gapped / never checked): say nothing rather than lie.
    if (count === null) return null;
    return (
        <>
            <span aria-hidden="true">·</span>
            {count === 0 ? <span>up to date</span> : <FixesPill count={count} href={href} />}
        </>
    );
}

/**
 * Admin build-level fixes notice (ROK-1475 S4).
 * `v1.4.0 · 3 fixes available` — the count pill links to the GitHub compare
 * span. Subordinate to the amber UpdateBanner (feature-level signal), which
 * keeps the one-banner slot; this is an inline line, not a second banner.
 * `0` renders "up to date"; `null` renders the version alone. The count is a
 * lower bound when main is >250 commits ahead (compare API truncation).
 */
export function BuildFixesNotice({ enabled }: { enabled: boolean }) {
    const { data } = useUpdateStatus(enabled);
    if (!enabled || !data) return null;
    return (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="build-fixes-notice">
            <span className="text-secondary">{versionLabel(data.currentVersion)}</span>
            <FixesClause count={data.fixesAvailable} href={data.fixesCompareUrl} />
        </p>
    );
}

/**
 * ROK-1836 — the Valheim server hub's Characters tab body (D1). Takes the
 * hub's Pelican server id; `charactersHubTab` in `register.ts` adapts it to
 * the ROK-1831 `HubTab` seam once that lands.
 */
import { useLocation, useSearchParams } from 'react-router-dom';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useValheimCharacterPages } from '../hooks/use-valheim-characters';
import { ValheimCharacterRow } from './valheim-character-row';
import { ValheimClaimBanner } from './valheim-claim-banner';
import {
    CLAIM_BANNER_COPY,
    CLAIM_FILTER_PARAM,
} from './valheim-claim-banner.helpers';

function Quiet({ children, role }: { children: string; role?: 'alert' }) {
    return (
        <div className="py-12 text-center" role={role}>
            <p className="text-sm text-muted">{children}</p>
        </div>
    );
}

function TabHeading({ count }: { count: string | null }) {
    return (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2">
            <h2
                id="valheim-characters-h"
                className="text-lg font-semibold text-foreground"
            >
                Characters{' '}
                {count !== null && (
                    <span className="text-sm font-medium text-muted">
                        {count}
                    </span>
                )}
            </h2>
            <span className="text-xs text-dim">
                Characters seen on this server by the Valheim Link mod
            </span>
        </div>
    );
}

function RowList({
    rows,
    hubPath,
}: {
    rows: ValheimCharacterSummary[];
    hubPath: string;
}) {
    if (rows.length === 0) return null;
    return (
        <ul className="flex flex-col gap-2">
            {rows.map((c) => (
                <ValheimCharacterRow
                    key={c.id}
                    character={c}
                    hubPath={hubPath}
                />
            ))}
        </ul>
    );
}

function LoadMore({
    pages,
}: {
    pages: ReturnType<typeof useValheimCharacterPages>;
}) {
    if (!pages.hasMore && !pages.moreFailed) return null;
    return (
        <div className="mt-3 flex flex-col items-center gap-2">
            {pages.moreFailed && (
                <p role="alert" className="text-sm text-muted">
                    Couldn't load more characters.
                </p>
            )}
            <Button
                variant="secondary"
                loading={pages.loadingMore}
                onClick={pages.loadMore}
            >
                Load more characters
            </Button>
        </div>
    );
}

function TabStates({ pages }: { pages: ReturnType<typeof useValheimCharacterPages> }) {
    if (pages.isError) {
        return <Quiet role="alert">Couldn't load characters. Try again in a moment.</Quiet>;
    }
    if (!pages.isSuccess || pages.rows.length > 0) return null;
    return (
        <Quiet>
            No characters yet. They appear after a player joins with the
            Valheim Link mod.
        </Quiet>
    );
}

function countLabel(pages: ReturnType<typeof useValheimCharacterPages>): string {
    if (pages.total !== null) return String(pages.total);
    return `${pages.rows.length}${pages.hasMore ? '+' : ''}`;
}

/** ROK-1933: the "Unclaimed only" toggle; the banner's Pick jumps here with it on. */
function useUnclaimedFilter(): [boolean, () => void] {
    const [params, setParams] = useSearchParams();
    const on = params.get(CLAIM_FILTER_PARAM) === '1';
    const toggle = (): void => {
        const next = new URLSearchParams(params);
        if (on) next.delete(CLAIM_FILTER_PARAM);
        else next.set(CLAIM_FILTER_PARAM, '1');
        setParams(next, { replace: true });
    };
    return [on, toggle];
}

function UnclaimedToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <div className="mb-3 flex">
            <Button variant={on ? 'primary' : 'secondary'} size="sm" aria-pressed={on} onClick={onToggle}>
                {CLAIM_BANNER_COPY.unclaimedFilter}
            </Button>
        </div>
    );
}

export function ValheimCharactersTab({
    serverId,
    showClaimBanner = true,
}: {
    serverId: number;
    /** ROK-1933: false for hub visitors — they never see the claim banner. */
    showClaimBanner?: boolean;
}) {
    const { pathname, search } = useLocation();
    const query = useValheimCharacterPages(serverId);
    const [unclaimedOnly, toggleUnclaimed] = useUnclaimedFilter();
    const rows = unclaimedOnly
        ? query.rows.filter((c) => c.claimedBy === null)
        : query.rows;
    const count = countLabel(query);
    return (
        <section
            aria-labelledby="valheim-characters-h"
            aria-busy={query.isPending}
        >
            <TabHeading count={query.isSuccess ? count : null} />
            {showClaimBanner && <ValheimClaimBanner serverId={serverId} rows={query.rows} complete={query.isSuccess && !query.hasMore} />}
            {query.isSuccess && query.rows.length > 0 && <UnclaimedToggle on={unclaimedOnly} onToggle={toggleUnclaimed} />}
            <TabStates pages={query} />
            <RowList rows={rows} hubPath={`${pathname}${search}#characters`} />
            <LoadMore pages={query} />
        </section>
    );
}

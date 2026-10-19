/**
 * ROK-1836 — the Valheim server hub's Characters tab body (D1). Takes the
 * hub's Pelican server id; `charactersHubTab` in `register.ts` adapts it to
 * the ROK-1831 `HubTab` seam once that lands.
 */
import { useLocation } from 'react-router-dom';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useValheimCharacterPages } from '../hooks/use-valheim-characters';
import { ValheimCharacterRow } from './valheim-character-row';

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

export function ValheimCharactersTab({ serverId }: { serverId: number }) {
    const { pathname, search } = useLocation();
    const query = useValheimCharacterPages(serverId);
    const { rows } = query;
    const count =
        query.total !== null
            ? String(query.total)
            : `${rows.length}${query.hasMore ? '+' : ''}`;
    return (
        <section
            aria-labelledby="valheim-characters-h"
            aria-busy={query.isPending}
        >
            <TabHeading count={query.isSuccess ? count : null} />
            {query.isError && (
                <Quiet role="alert">
                    Couldn't load characters. Try again in a moment.
                </Quiet>
            )}
            {query.isSuccess && rows.length === 0 && (
                <Quiet>
                    No characters yet. They appear after a player joins with the
                    Valheim Link mod.
                </Quiet>
            )}
            <RowList rows={rows} hubPath={`${pathname}${search}#characters`} />
            <LoadMore pages={query} />
        </section>
    );
}

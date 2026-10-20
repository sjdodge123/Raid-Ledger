/**
 * ROK-1870 — `/hubs`: every active community hub, searchable and filtered
 * through the funnel standard, filters persisted in the URL, "Load more" for
 * the next cursor page (not infinite scroll — ROK-1868 D5 precedent).
 */
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { Button } from '../components/ui/button';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { SearchInput } from '../components/ui/search-input';
import { FilterEntryTrigger } from '../components/ui/filter-entry';
import {
    directoryActiveCount, readDirectoryParams, useHubsDirectory, useJoinDirectoryHub, writeDirectoryParams,
    type HubsDirectoryParams,
} from './use-hubs-directory';
import { HubsDirectoryFilters } from './hubs-directory-filters';
import { HubDirectoryCard } from './hubs-directory-card';

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }): JSX.Element {
    return (
        <div className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-muted">
            {filtered ? (
                <p>No hubs match — <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button></p>
            ) : (
                <p>No community hubs yet. Start one from a game&apos;s page.</p>
            )}
        </div>
    );
}

function HubGrid({ hubs, params }: { hubs: HubDirectoryEntry[]; params: HubsDirectoryParams }): JSX.Element {
    const join = useJoinDirectoryHub(params);
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hubs.map((h) => (
                <HubDirectoryCard key={h.id} hub={h} onJoin={() => join.mutate(h.id)} joining={join.isPending && join.variables === h.id} />
            ))}
        </div>
    );
}

function PageHeader(): JSX.Element {
    return (
        <header>
            <h1 className="text-2xl font-semibold text-foreground">Community hubs</h1>
            <p className="text-sm text-muted">Groups for the games we play. Join any of them.</p>
        </header>
    );
}

function useDirectoryUrl(): [HubsDirectoryParams, (next: HubsDirectoryParams) => void] {
    const [search, setSearch] = useSearchParams();
    const update = (next: HubsDirectoryParams): void => setSearch(writeDirectoryParams(next), { replace: true });
    return [readDirectoryParams(search), update];
}

/** The community hub directory page. */
export function HubsDirectoryPage(): JSX.Element {
    const [params, update] = useDirectoryUrl();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [text, setText] = useState(params.q ?? '');
    const query = useHubsDirectory(params);
    const hubs = query.data?.pages.flatMap((p) => p.items) ?? [];
    const gameName = hubs.find((h) => h.gameId === params.gameId)?.gameName;
    const filtered = directoryActiveCount(params) > 0 || Boolean(params.q);
    const clear = (): void => { setText(''); update({ membership: 'all', sort: params.sort }); };
    return (
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 pb-24">
            <PageHeader />
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <SearchInput label="Search hubs" placeholder="Search hubs" value={text} onChange={setText}
                        onSearch={(q) => update({ ...params, q: q.trim() || undefined })} />
                </div>
                <FilterEntryTrigger activeCount={directoryActiveCount(params)} isOpen={filtersOpen} onOpenChange={setFiltersOpen} />
            </div>
            <HubsDirectoryFilters params={params} onChange={update} gameName={gameName} isOpen={filtersOpen} onOpenChange={setFiltersOpen} />
            {query.isPending && <div data-testid="hubs-directory-loading" className="flex justify-center py-8"><LoadingSpinner /></div>}
            {query.isError && <p role="alert" className="text-sm text-danger">Couldn’t load hubs. Try again in a moment.</p>}
            {query.isSuccess && (hubs.length === 0 ? <EmptyState filtered={filtered} onClear={clear} /> : <HubGrid hubs={hubs} params={params} />)}
            {query.hasNextPage && (
                <div className="flex justify-center">
                    <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more</Button>
                </div>
            )}
        </div>
    );
}

export default HubsDirectoryPage;

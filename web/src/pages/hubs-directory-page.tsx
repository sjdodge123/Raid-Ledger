/**
 * ROK-1870 / ROK-1875 — `/hubs`: every visible hub of every live kind
 * (community, game server, WoW guild), searchable and filtered
 * through the funnel standard, filters persisted in the URL, "Load more" for
 * the next cursor page (not infinite scroll — ROK-1868 D5 precedent).
 */
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GuildKind, HubDirectoryEntry } from '@raid-ledger/contract';
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
import { HUB_KIND_LABEL } from '../components/layout/hub-nav/hub-kind-chip';

interface EmptyStateProps { filtered: boolean; kind: GuildKind | undefined; onClear: () => void }

/** Filtered: names the kind when one is picked ("No server hubs match"); unfiltered: how to start one. */
function EmptyState({ filtered, kind, onClear }: EmptyStateProps): JSX.Element {
    const noun = kind ? `${HUB_KIND_LABEL[kind].toLowerCase()} hubs` : 'hubs';
    return (
        <div className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-muted">
            {filtered ? (
                <p>No {noun} match — <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button></p>
            ) : (
                <p>No hubs yet. Start a community hub from a game&apos;s page.</p>
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
            <h1 className="text-2xl font-semibold text-foreground">Hubs</h1>
            <p className="text-sm text-muted">Game servers, guilds and community groups for the games we play.</p>
        </header>
    );
}

function useDirectoryUrl(): [HubsDirectoryParams, (next: HubsDirectoryParams) => void] {
    const [search, setSearch] = useSearchParams();
    const update = (next: HubsDirectoryParams): void => setSearch(writeDirectoryParams(next), { replace: true });
    return [readDirectoryParams(search), update];
}

function LoadMore({ query }: { query: ReturnType<typeof useHubsDirectory> }): JSX.Element | null {
    if (!query.hasNextPage) return null;
    return (
        <div className="flex justify-center">
            <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more</Button>
        </div>
    );
}

/** The hub directory page. */
export function HubsDirectoryPage(): JSX.Element {
    const [params, update] = useDirectoryUrl();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [text, setText] = useState(params.q ?? '');
    const query = useHubsDirectory(params);
    const hubs = query.data?.pages.flatMap((p) => p.items) ?? [];
    const gameName = hubs.find((h) => h.gameId === params.gameId)?.gameName;
    const kinds = query.data?.pages[0]?.kinds ?? [];
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
            <HubsDirectoryFilters params={params} onChange={update} gameName={gameName} kinds={kinds} isOpen={filtersOpen} onOpenChange={setFiltersOpen} />
            {query.isPending && <div data-testid="hubs-directory-loading" className="flex justify-center py-8"><LoadingSpinner /></div>}
            {query.isError && <p role="alert" className="text-sm text-danger">Couldn’t load hubs. Try again in a moment.</p>}
            {query.isSuccess && (hubs.length === 0 ? <EmptyState filtered={filtered} kind={params.kind} onClear={clear} /> : <HubGrid hubs={hubs} params={params} />)}
            <LoadMore query={query} />
        </div>
    );
}

export default HubsDirectoryPage;

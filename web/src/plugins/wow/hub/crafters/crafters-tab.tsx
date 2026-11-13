/**
 * ROK-1790 — the WoW: Forever Crafters tab body (lazy chunk): the guild
 * crafters directory. Reads the shared roster-insights payload (same query as
 * the Guild professions widget and the Members coverage strip, spec D1), then
 * search + the funnel filters (`CraftersToolbar`) narrow it into one
 * `CrafterCard` per profession. Visibility (members/staff with data) is the
 * tab registration's job (`crafters-tab.register.ts`).
 */
import { useState, type JSX } from 'react';
import type { HubCtx } from '../../../hub-module';
import { Button } from '../../../../components/ui/button';
import { useRosterInsights } from '../../hub-widgets/use-roster-insights';
import { ProfessionsEmpty } from '../../hub-widgets/professions-empty';
import { FreshnessFooter } from '../../hub-widgets/freshness-footer';
import {
    characterCount, charactersWithProfessions, type RosterProfession,
} from '../../hub-widgets/professions.helpers';
import { CrafterCard } from './crafter-card';
import { CraftersToolbar } from './crafters-filters';
import {
    EMPTY_CRAFTER_FILTERS, activeCount, filterCrafters, professionOptions, type CrafterFilters,
} from './crafters.helpers';

/** 1 column on phones, 2 at `md`, 3 at `lg` (spec Scope). */
const GRID_CLASS = 'grid gap-3 md:grid-cols-2 lg:grid-cols-3';

/**
 * The Crafters tab panel. Takes only `page` (a `HubCtx` subset), so it is
 * still a valid `HubTab.component` and tests need no raids query.
 */
export default function CraftersTab({ page }: Pick<HubCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id);
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load crafters.</p>;
    if (isPending) return <CraftersSkeleton />;
    const professions = data.professions ?? [];
    if (professions.length === 0) return <ProfessionsEmpty gameId={page.guild.gameId} />;
    return (
        <section aria-labelledby="crafters-title" className="flex flex-col gap-3">
            <CraftersDirectory professions={professions} hubId={page.guild.id} />
            {data.freshness.roster !== null && <FreshnessFooter freshness={data.freshness.roster} testId="crafters-freshness" />}
        </section>
    );
}

function CraftersDirectory({ professions, hubId }: { professions: readonly RosterProfession[]; hubId: number }): JSX.Element {
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<CrafterFilters>(EMPTY_CRAFTER_FILTERS);
    const shown = filterCrafters(professions, query, filters);
    const clearAll = (): void => {
        setQuery('');
        setFilters(EMPTY_CRAFTER_FILTERS);
    };
    return (
        <>
            <CraftersHeader summary={summary(shown)} />
            <CraftersToolbar query={query} onQuery={setQuery} filters={filters} onFilters={setFilters}
                professions={professionOptions(professions)} />
            {shown.length > 0 ? (
                <ul aria-label="Crafters by profession" className={GRID_CLASS}>
                    {shown.map((p) => <CrafterCard key={p.name} profession={p} hubId={hubId} />)}
                </ul>
            ) : (
                <NoMatch query={query} filtered={activeCount(filters) > 0} onClear={clearAll} />
            )}
        </>
    );
}

/** The tab title row; `summary` is omitted while loading. */
function CraftersHeader({ summary: line }: { summary?: string }): JSX.Element {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-edge pb-2">
            <h2 id="crafters-title" className="text-lg font-semibold text-foreground">Crafters</h2>
            {line !== undefined && <span className="text-sm text-secondary">{line}</span>}
        </div>
    );
}

/** §4.6 loading: keep the frame (title + toolbar row) and grey the cards, never a lone block. */
function CraftersSkeleton(): JSX.Element {
    return (
        <section aria-labelledby="crafters-title" aria-busy="true" data-testid="crafters-loading" className="flex flex-col gap-3">
            <CraftersHeader />
            <div className="h-11 animate-pulse rounded-lg bg-panel" />
            <div aria-hidden="true" className={GRID_CLASS}>
                {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-lg border border-edge bg-panel" />)}
            </div>
        </section>
    );
}

/** `4 characters · 2 professions` for what is on screen. */
function summary(shown: readonly RosterProfession[]): string {
    const n = shown.length;
    return `${characterCount(charactersWithProfessions(shown))} · ${n} ${n === 1 ? 'profession' : 'professions'}`;
}

/** §4.5 empty state for a search/filter miss, with one next step. */
function NoMatch({ query, filtered, onClear }: { query: string; filtered: boolean; onClear: () => void }): JSX.Element {
    const q = query.trim();
    const label = q !== '' && filtered ? 'Clear search and filters' : q !== '' ? 'Clear search' : 'Clear filters';
    return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted">
                {q !== '' ? `No crafter matches “${q}”.` : 'No crafter matches these filters.'}
            </p>
            <Button variant="secondary" size="sm" onClick={onClear}>{label}</Button>
        </div>
    );
}

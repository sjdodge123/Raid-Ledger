/**
 * ROK-1790 — the Crafters tab body (lazy chunk). L1 shell: lists each
 * profession with its crafters from the shared roster-insights payload. The
 * L2 lane replaces the body with the directory (search, `FilterEntry` funnel,
 * profession cards with skill bars) — keep the default export and its props.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../../hub-module';
import { useRosterInsights } from '../../hub-widgets/use-roster-insights';
import { ProfessionsEmpty } from '../../hub-widgets/professions-empty';
import { memberCount } from '../../hub-widgets/professions.helpers';
import { EMPTY_CRAFTER_FILTERS, filterCrafters } from './crafters.helpers';

/** The Crafters tab panel. */
export default function CraftersTab({ page }: HubCtx): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id);
    if (isPending) return <div className="h-24 animate-pulse rounded-lg bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load crafters.</p>;
    const professions = filterCrafters(data.professions ?? [], '', EMPTY_CRAFTER_FILTERS);
    if (professions.length === 0) return <ProfessionsEmpty gameId={page.guild.gameId} />;
    return (
        <section aria-labelledby="crafters-title" className="flex flex-col gap-3">
            <h2 id="crafters-title" className="text-lg font-semibold text-foreground">Crafters</h2>
            <ul className="flex flex-col gap-2" aria-label="Crafters by profession">
                {professions.map((p) => (
                    <li key={p.name} className="rounded-lg border border-edge bg-panel p-3 text-sm">
                        <span className="font-medium text-foreground">{p.name}</span>
                        <span className="ml-2 text-xs text-muted">{memberCount(p.members.length)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

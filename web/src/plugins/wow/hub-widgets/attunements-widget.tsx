/**
 * ROK-1927 (W13) — WoW: Forever "Attunements" Overview card body (spec §5.1,
 * §7, mockup F1–F5): one row per attunement group (faction variants merged)
 * with `done/total` attuned, a `GuildMeter`, and a muted "N in progress · N
 * without data" line; untracked groups greyed "Not tracked yet"; the shared
 * `FreshnessFooter` (warning past 14 days). Core draws the `WidgetCard`
 * chrome and the "See who" header action (`attunements-action.tsx`); the
 * per-member detail (P5) opens through `attunements-detail-store.ts`.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { QuietEmpty } from '../../../components/hub/card-bits';
import { FreshnessFooter } from './freshness-footer';
import {
    ATTUNEMENTS_NO_DATA_COPY, ATTUNEMENTS_UNVERIFIED_COPY, attunedPct, attunementsFreshness, groupAttunements,
    nobodyHasQuestData, rowNote, untrackedCopy, type AttunementGroupRow,
} from './attunements.helpers';
import { useRosterInsights } from './use-roster-insights';

/** The Attunements widget body (lazy-loaded). */
export default function AttunementsWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element | null {
    const { data, isPending, isError } = useRosterInsights(page.guild.id, false);
    if (isPending) return <div data-testid="attunements-loading" className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load attunements.</p>;
    const section = data.attunements;
    if (section === undefined) return null;
    const rows = groupAttunements(section.attunements);
    if (rows.length === 0) return <QuietEmpty testId="attunements-unverified">{ATTUNEMENTS_UNVERIFIED_COPY}</QuietEmpty>;
    const nobody = nobodyHasQuestData(rows);
    return (
        <div data-testid="attunements" className="flex flex-col">
            <ul className="flex flex-col gap-3">
                {rows.map((row) => <AttunementRow key={row.groupKey} row={row} hideNoData={nobody} />)}
            </ul>
            {nobody && <p data-testid="attunements-no-data" className="mt-3 text-sm text-muted">{ATTUNEMENTS_NO_DATA_COPY}</p>}
            <FreshnessFooter freshness={attunementsFreshness(section)} testId="attunements-freshness" />
        </div>
    );
}

function AttunementRow({ row, hideNoData }: { row: AttunementGroupRow; hideNoData: boolean }): JSX.Element {
    if (!row.trackable) {
        return (
            <li data-testid={`attunement-row-${row.groupKey}`} data-tracked="false" className="flex min-h-11 flex-col justify-center">
                <span className="text-sm font-medium text-dim">{row.instance}</span>
                <span className="text-xs text-dim">{untrackedCopy(row)}</span>
            </li>
        );
    }
    const note = rowNote(row, hideNoData);
    return (
        <li data-testid={`attunement-row-${row.groupKey}`} data-tracked="true" className="flex min-h-11 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{row.instance}</span>
                <span data-testid="attunement-count" className="text-sm tabular-nums text-foreground">
                    {row.done}/{row.total}<span className="sr-only"> attuned</span>
                </span>
            </div>
            <GuildMeter pct={attunedPct(row)} label={`${row.instance}: ${row.done} of ${row.total} attuned`} />
            {note !== null && <span data-testid="attunement-note" className="text-xs text-muted">{note}</span>}
        </li>
    );
}

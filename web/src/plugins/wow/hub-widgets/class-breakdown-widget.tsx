/**
 * ROK-1921 (spec ROK-1905 W1) — WoW: Forever "Class breakdown" hub widget: one
 * bar per class with its count and the class icon. A bar is a disclosure that
 * lists the class's roster rows: linked names open `/characters/:id`, unlinked
 * names jump to the Members tab (it has no class filter yet). Theme tokens
 * only — there are no class-colour tokens, so the Blizzard class icon carries
 * the class identity and the bar uses the neutral `secondary` token.
 */
import { useState, type JSX } from 'react';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { CharacterLink } from '../../../components/hub/character-link';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { Button } from '../../../components/ui/button';
import { getClassIconUrl } from '../lib/class-icons';
import { useRosterInsights } from './use-roster-insights';
import { RosterWidgetShell } from './widget-shell';

type ClassRow = WowRosterInsightsDto['classes'][number];

function MemberName({ m }: { m: ClassRow['members'][number] }): JSX.Element {
    const level = m.level === null ? null : <span className="ml-1 text-muted">{m.level}</span>;
    if (m.characterId !== null) return <li><CharacterLink name={m.name} characterId={m.characterId} />{level}</li>;
    return (
        <li>
            <a href="#members" className={`rounded-sm font-medium text-foreground underline-offset-2 hover:underline ${FOCUS_RING}`}>{m.name}</a>
            {level}
        </li>
    );
}

function ClassBar({ row, max }: { row: ClassRow; max: number }): JSX.Element {
    const [open, setOpen] = useState(false);
    const icon = getClassIconUrl(row.class);
    const listId = `forever-class-members-${row.class.replace(/\s+/g, '-')}`;
    const width = max === 0 ? 0 : Math.round((row.count / max) * 100);
    return (
        <li>
            <Button variant="bare" data-testid={`forever-class-${row.class}`} aria-expanded={open} aria-controls={listId}
                onClick={() => setOpen((v) => !v)}
                className="min-h-11 w-full justify-start gap-2 rounded-md px-1 text-left text-sm hover:bg-overlay">
                {icon !== null && <img src={icon} alt="" className="h-5 w-5 shrink-0 rounded-sm" />}
                <span className="w-24 shrink-0 truncate font-medium text-foreground">{row.class}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-overlay" aria-hidden="true">
                    <span className="block h-full rounded-full bg-secondary" style={{ width: `${width}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-semibold text-foreground">{row.count}</span>
            </Button>
            {open && (
                <ul id={listId} data-testid={`forever-class-members-${row.class}`}
                    className="mb-2 ml-8 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
                    {row.members.map((m) => <MemberName key={`${m.characterId ?? 'u'}-${m.name}`} m={m} />)}
                </ul>
            )}
        </li>
    );
}

function ClassBars({ insights }: { insights: WowRosterInsightsDto }): JSX.Element {
    const rows = [...insights.classes].sort((a, b) => b.count - a.count);
    const max = rows[0]?.count ?? 0;
    return <ul className="flex flex-col gap-0.5">{rows.map((r) => <ClassBar key={r.class} row={r} max={max} />)}</ul>;
}

/** W1 body — registered lazily by `class-level.register.ts`. */
export default function ClassBreakdownWidget({ page }: HubWidgetCtx): JSX.Element {
    const [mainsOnly, setMainsOnly] = useState(false);
    const query = useRosterInsights(page.guild.id, mainsOnly);
    return (
        <RosterWidgetShell query={query} mainsOnly={mainsOnly} onMainsOnly={setMainsOnly}>
            {(insights) => <ClassBars insights={insights} />}
        </RosterWidgetShell>
    );
}

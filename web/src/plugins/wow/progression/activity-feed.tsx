/**
 * ROK-1789 Part B (B5–B8) — the guild Progression tab's activity feed: first
 * kills, joins, roster imports, ended events, dings and milestones from the
 * last 30 days, newest first. Shows `GUILD_ACTIVITY_PAGE` rows, then the rest
 * behind `ShowAllToggle` (B7). Prototype: `proposed/ActivityFeed.tsx` @
 * `9f2a1103c`; the kind pill maps to `StatusChip`.
 */
import { useId, type JSX } from 'react';
import {
    GUILD_ACTIVITY_PAGE,
    type WowGuildActivityDto,
    type WowGuildActivityEntryDto,
} from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { StatusChip } from '../../../components/ui/status-chip';
import { ShowAllToggle } from '../components/show-all-toggle';
import { useRowCap } from '../hooks/use-row-cap';
import {
    ACTIVITY_EMPTY_COPY, ACTIVITY_FOOTER_COPY, KIND_META, entryActor, entryText,
} from './activity.helpers';
import { formatShortDate } from '../lib/short-date';

function ActivityRow({ entry }: { entry: WowGuildActivityEntryDto }): JSX.Element {
    const meta = KIND_META[entry.kind];
    const actor = entryActor(entry);
    return (
        <li data-testid="guild-activity-row" data-kind={entry.kind}
            className="flex flex-col gap-1 border-l-2 border-edge-strong py-0.5 pl-3">
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={meta.tone} title={meta.label}>{meta.label}</StatusChip>
                <time dateTime={entry.at} className="text-xs text-muted">{formatShortDate(entry.at)}</time>
            </div>
            <p data-testid="guild-activity-text" className="text-sm text-secondary">
                {actor && <CharacterLink name={actor.name} characterId={actor.characterId} />}
                {entryText(entry)}
            </p>
        </li>
    );
}

function ActivityList({ entries }: { entries: WowGuildActivityDto['entries'] }): JSX.Element {
    const listId = useId();
    const { visible, capped, expanded, toggle } = useRowCap(entries, GUILD_ACTIVITY_PAGE);
    return (
        <>
            <ol id={listId} data-testid="guild-activity-list" className="flex flex-col gap-3">
                {visible.map((e) => <ActivityRow key={e.id} entry={e} />)}
            </ol>
            {capped && <ShowAllToggle total={entries.length} expanded={expanded} onToggle={toggle} controls={listId} />}
        </>
    );
}

/** The activity card; LB6's Progression tab renders it in the right column (stacked below 1024px). */
export function ActivityFeed({ activity }: { activity: WowGuildActivityDto }): JSX.Element {
    const { entries } = activity;
    const titleId = useId();
    return (
        <section data-testid="guild-activity-feed" aria-labelledby={titleId}
            className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
            <div className="flex items-baseline justify-between gap-2">
                <h3 id={titleId} className="text-base font-semibold text-foreground">Guild activity</h3>
                <span className="text-xs text-dim">Last {activity.windowDays} days</span>
            </div>
            {entries.length === 0
                ? <p data-testid="guild-activity-empty" className="text-sm text-muted">{ACTIVITY_EMPTY_COPY}</p>
                : <ActivityList entries={entries} />}
            <p className="text-xs text-dim">{ACTIVITY_FOOTER_COPY}</p>
        </section>
    );
}

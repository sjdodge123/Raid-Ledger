/**
 * ROK-2207 prototype — the planner tab body (OQ1 ruled: hub tab) for one
 * dungeon, desktop or phone. Quest layout is the event page's grouping (ruled);
 * the Create-event set is OQ3 Option B (ruled).
 */
import { useMemo, type JSX } from 'react';
import { questsFor, readinessFor } from './dungeon-planner.fixtures';
import { INSTANCES } from './forever-dungeons.fixtures';
import { plannerLinks, type PlannerState } from './use-planner-state';
import { instanceRange } from './planner-helpers';
import { CopyLinkButton, CreateEventButtons, DungeonPicker, UnverifiedHint, WowheadLink } from './planner-controls';
import { GroupChips } from './character-picker';
import { LevelsList, QuestBreakdown } from './planner-breakdown';

export type Layout = 'desktop' | 'phone';
export type { PlannerState } from './use-planner-state';

function QuestSection({ s }: { s: PlannerState }): JSX.Element {
    const signups = useMemo(() => readinessFor(s.chars, s.instance.id), [s.chars, s.instance.id]);
    return <QuestBreakdown quests={questsFor(s.instance.id)} signups={signups} />;
}

function DungeonSection({ s, phone }: { s: PlannerState; phone: boolean }): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Dungeon · {s.instance.name} {instanceRange(s.instance)}
                </p>
                {!phone && <UnverifiedHint />}
                <WowheadLink instance={s.instance} />
            </div>
            <DungeonPicker instances={INSTANCES} selectedId={s.instance.id} onSelect={s.setInstanceId} phone={phone} />
        </div>
    );
}

/** Create-event set for the current plan (shared by the header and the phone's sticky bar). */
function Actions({ s }: { s: PlannerState }): JSX.Element {
    const l = plannerLinks(s);
    return <CreateEventButtons plainUrl={l.plain} inviteUrl={l.invite} inviteCount={l.inviteCount}
        excluded={l.excluded} empty={s.chars.length === 0} />;
}

/** The full planner (hub tab body) in one layout. */
export function PlannerBody({ s, layout }: { s: PlannerState; layout: Layout }): JSX.Element {
    const phone = layout === 'phone';
    return (
        <div className="rounded-lg border border-edge bg-surface p-4">
            <div className={`space-y-4 ${phone ? 'pb-6' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold text-foreground">Dungeon planner</h2>
                    <div className="flex flex-wrap items-start gap-2">
                        <CopyLinkButton url={plannerLinks(s).share} />
                        {!phone && <Actions s={s} />}
                    </div>
                </div>
                <DungeonSection s={s} phone={phone} />
                <GroupChips s={s} instance={s.instance} />
                <div className="border-t border-edge-subtle pt-3"><LevelsList chars={s.chars} instance={s.instance} /></div>
                <div className="border-t border-edge-subtle pt-3"><QuestSection s={s} /></div>
            </div>
            {phone && (
                <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-edge bg-surface p-3">
                    <Actions s={s} />
                </div>
            )}
        </div>
    );
}

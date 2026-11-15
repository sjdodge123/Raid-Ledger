/**
 * ROK-2207 prototype — the planner body (desktop or phone layout) and the
 * cramped Overview-widget alternative (OQ1 Option B). State is local; the
 * build keeps it in the URL (spec D5).
 */
import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { QuestMatrix } from '../../plugins/wow/hub-widgets/dungeon-quests-matrix';
import { DALARAN_ID, DALARAN_QUESTS, INSTANCES, MATRIX_QUESTS, readinessFor } from './dungeon-planner.fixtures';
import { plannerLinks, type PlannerState } from './use-planner-state';
import { instanceRange } from './planner-helpers';
import { CopyLinkButton, CreateEventButtons, DungeonLinks, DungeonPicker, GroupChips } from './planner-controls';
import { LevelsList, QuestBreakdown } from './planner-breakdown';

export type Layout = 'desktop' | 'phone';
export type QuestLayout = 'grouped' | 'matrix';
export type { PlannerState } from './use-planner-state';

function QuestSection({ s, questLayout }: { s: PlannerState; questLayout: QuestLayout }): JSX.Element {
    const signups = useMemo(() => readinessFor(s.chars), [s.chars]);
    if (s.instance.id !== DALARAN_ID) {
        return <p className="text-sm text-muted">Prototype fixtures only carry quests for City of Dalaran — pick it to see the breakdown.</p>;
    }
    if (questLayout === 'matrix') return <QuestMatrix quests={MATRIX_QUESTS} signups={signups} label="Quest readiness" />;
    return <QuestBreakdown quests={DALARAN_QUESTS} signups={signups} />;
}

function DungeonSection({ s, phone }: { s: PlannerState; phone: boolean }): JSX.Element {
    return (
        <div className={phone ? 'space-y-3' : 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4'}>
            <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Dungeon · {s.instance.name} {instanceRange(s.instance)}
                </p>
                <DungeonPicker instances={INSTANCES} selectedId={s.instance.id} onSelect={s.setInstanceId} />
            </div>
            <DungeonLinks instance={s.instance} />
        </div>
    );
}

/** The full planner (tab body) in one layout. `invite` toggles OQ3 Option B's extra button. */
export function PlannerBody({ s, layout, invite, questLayout = 'grouped' }: {
    s: PlannerState; layout: Layout; invite: boolean; questLayout?: QuestLayout;
}): JSX.Element {
    const l = plannerLinks(s);
    const phone = layout === 'phone';
    return (
        <div className="space-y-4 rounded-lg border border-edge bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">Dungeon planner</h2>
                <div className="flex flex-wrap gap-2">
                    <CopyLinkButton url={l.share} />
                    {!phone && <CreateEventButtons plainUrl={l.plain} inviteUrl={l.invite} invite={invite} count={s.chars.length} />}
                </div>
            </div>
            <DungeonSection s={s} phone={phone} />
            <GroupChips chars={s.chars} instance={s.instance} onRemove={s.remove} onAdd={s.addNext} canAdd={s.canAdd} />
            <div className="border-t border-edge-subtle pt-3"><LevelsList chars={s.chars} instance={s.instance} /></div>
            <div className="border-t border-edge-subtle pt-3"><QuestSection s={s} questLayout={questLayout} /></div>
            {phone && (
                <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-edge bg-surface p-3">
                    <CreateEventButtons plainUrl={l.plain} inviteUrl={l.invite} invite={invite} count={s.chars.length} />
                </div>
            )}
        </div>
    );
}

/** OQ1 Option B — the same planner squeezed into an Overview widget card. */
export function PlannerWidget({ s }: { s: PlannerState }): JSX.Element {
    const l = plannerLinks(s);
    return (
        <div className="max-w-xl space-y-3 rounded-lg border border-edge bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Dungeon planner</h3>
                <CopyLinkButton url={l.share} />
            </div>
            <p className="text-sm text-secondary">{s.instance.name} · {instanceRange(s.instance)}</p>
            <GroupChips chars={s.chars} instance={s.instance} onRemove={s.remove} onAdd={s.addNext} canAdd={s.canAdd} />
            <LevelsList chars={s.chars} instance={s.instance} />
            <p className="text-xs text-muted">7 quests — no room for the breakdown in a card.</p>
            <Link to="#" className="text-sm text-secondary hover:underline">Open the full planner ▸</Link>
        </div>
    );
}

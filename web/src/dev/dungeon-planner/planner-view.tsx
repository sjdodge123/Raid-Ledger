/**
 * ROK-2207 prototype — the planner tab body (OQ1 ruled: hub tab) for one
 * dungeon, desktop or phone. Quest layout is the event page's grouping (ruled);
 * the Create-event set is OQ3 Option B (ruled); one dungeon per plan (OQ2 A,
 * ruled); quests filtered to the guild's single faction (ruled ~19:05Z).
 */
import { useMemo, type JSX } from 'react';
import { DEMO_GUILD_FACTION, questsFor, readinessFor } from './dungeon-planner.fixtures';
import { FACTION_LABEL, hiddenNote, questsForGuild, type GuildFaction } from './planner-faction';
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
    const { shown, hidden } = questsForGuild(questsFor(s.instance.id), DEMO_GUILD_FACTION);
    return <QuestBreakdown quests={shown} signups={signups} note={hiddenNote(hidden, DEMO_GUILD_FACTION)} />;
}

const FACTION_PILL: Readonly<Record<GuildFaction, string>> = {
    alliance: 'border-faction-alliance/30 bg-faction-alliance/10 text-faction-alliance',
    horde: 'border-faction-horde/30 bg-faction-horde/10 text-faction-horde',
};

/** The guild's faction — the quest list shows only its quests (plus neutral ones). */
function FactionPill({ faction }: { faction: GuildFaction }): JSX.Element {
    return <span className={`rounded-full border px-2 py-0.5 text-xs ${FACTION_PILL[faction]}`}>{FACTION_LABEL[faction]} guild</span>;
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
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-foreground">Dungeon planner</h2>
                        <FactionPill faction={DEMO_GUILD_FACTION} />
                    </div>
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

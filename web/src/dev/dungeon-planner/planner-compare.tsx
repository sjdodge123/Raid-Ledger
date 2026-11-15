/**
 * ROK-2207 prototype — OQ2 Option B: several dungeons per plan. The same group
 * against 2–3 dungeons: a compact per-dungeon summary (in range, quests,
 * shareable, prereq-blocked), an expandable full breakdown and a Create-event
 * set per dungeon. Desktop = side-by-side columns; phone = a segmented
 * switcher showing one dungeon card at a time (no 3-column squeeze).
 */
import { useMemo, useState, type JSX } from 'react';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { RadioGroup } from '../../components/ui/radio-group';
import { RemovableChip } from '../../components/ui/removable-chip';
import { Select } from '../../components/ui/select';
import { questsFor, readinessFor } from './dungeon-planner.fixtures';
import { INSTANCES } from './forever-dungeons.fixtures';
import { compareStats, instanceRange } from './planner-helpers';
import { CopyLinkButton, CreateEventButtons, UnverifiedHint, WowheadLink } from './planner-controls';
import { GroupChips } from './character-picker';
import { LevelsList, QuestBreakdown } from './planner-breakdown';
import { MAX_DUNGEONS, plannerLinks, type PlannerState } from './use-planner-state';
import type { Layout } from './planner-view';

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-secondary">{label}</dt>
            <dd className="font-semibold text-foreground">{value}</dd>
        </div>
    );
}

/** One dungeon's column/card: header, the four numbers, details, Create event. */
function DungeonCard({ s, inst }: { s: PlannerState; inst: WowInstanceDto }): JSX.Element {
    const quests = questsFor(inst.id);
    const signups = useMemo(() => readinessFor(s.chars, inst.id), [s.chars, inst.id]);
    const st = compareStats(inst, s.chars, quests, signups);
    const l = plannerLinks(s, inst.id);
    return (
        <article aria-label={inst.name} className="min-w-0 space-y-3 rounded-md border border-edge-subtle bg-panel p-3">
            <header className="space-y-0.5">
                <h3 className="text-sm font-semibold text-foreground">{inst.name}</h3>
                <p className="flex flex-wrap items-baseline gap-2 text-xs text-secondary">
                    {inst.expansion} · {instanceRange(inst)} <UnverifiedHint /> <WowheadLink instance={inst} />
                </p>
            </header>
            <dl className="space-y-1">
                <Stat label="In range" value={`${st.inRange} of ${st.total}`} />
                {st.quests === 0
                    ? <p className="text-sm text-muted">No quest data for this dungeon yet.</p>
                    : <><Stat label="Quests available" value={String(st.quests)} /><Stat label="Shareable to grab" value={String(st.shareable)} />
                        <Stat label="Prereq-blocked" value={String(st.blocked)} /></>}
            </dl>
            <details className="rounded-md border border-edge-subtle px-2 py-1">
                <summary className="cursor-pointer py-1 text-sm text-secondary">Full breakdown</summary>
                <div className="space-y-3 py-2"><LevelsList chars={s.chars} instance={inst} /><QuestBreakdown quests={quests} signups={signups} /></div>
            </details>
            <CreateEventButtons plainUrl={l.plain} inviteUrl={l.invite} inviteCount={l.inviteCount} excluded={l.excluded}
                empty={s.chars.length === 0} plainLabel="Create event for this dungeon" />
        </article>
    );
}

/** The picked dungeons as chips plus a Select to add another (max 3). */
function DungeonChips({ s }: { s: PlannerState }): JSX.Element {
    const rest = INSTANCES.filter((i) => !s.dungeons.some((d) => d.id === i.id));
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Dungeons ({s.dungeons.length}/{MAX_DUNGEONS})</span>
            {s.dungeons.map((d) => (
                <RemovableChip key={d.id} label={d.name} removeLabel={`Remove ${d.name}`} onRemove={() => s.toggleDungeon(d.id)} />
            ))}
            {s.dungeons.length < MAX_DUNGEONS && (
                <Select aria-label="Add a dungeon to compare" value="" placeholder="+ Add a dungeon to compare" fieldSize="sm"
                    wrapperClassName="w-full max-w-xs" onChange={(e) => s.toggleDungeon(Number(e.target.value))}>
                    {rest.map((i) => <option key={i.id} value={i.id}>{i.name} · {instanceRange(i)}</option>)}
                </Select>
            )}
        </div>
    );
}

/** Phone: a segmented switcher picks which dungeon card shows. */
function PhoneCards({ s }: { s: PlannerState }): JSX.Element {
    const [shown, setShown] = useState<string>(String(s.dungeons[0]?.id ?? ''));
    const inst = s.dungeons.find((d) => String(d.id) === shown) ?? s.dungeons[0];
    return (
        <div className="space-y-3">
            <RadioGroup label="Dungeon to show" hideLabel appearance="segmented" value={String(inst?.id ?? '')} onChange={setShown}
                options={s.dungeons.map((d) => ({ value: String(d.id), label: d.name }))} />
            {inst && <DungeonCard s={s} inst={inst} />}
        </div>
    );
}

/** OQ2 Option B — the multi-dungeon plan, desktop columns or phone switcher. */
export function PlannerCompare({ s, layout }: { s: PlannerState; layout: Layout }): JSX.Element {
    const cols = s.dungeons.length >= 3 ? 'grid-cols-3' : 'grid-cols-2';
    return (
        <div className="space-y-4 rounded-lg border border-edge bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">Dungeon planner</h2>
                <CopyLinkButton url={plannerLinks(s).share} />
            </div>
            <DungeonChips s={s} />
            <GroupChips s={s} instance={s.instance} />
            {layout === 'phone'
                ? <PhoneCards s={s} />
                : <div className={`grid gap-3 ${cols}`}>{s.dungeons.map((d) => <DungeonCard key={d.id} s={s} inst={d} />)}</div>}
        </div>
    );
}

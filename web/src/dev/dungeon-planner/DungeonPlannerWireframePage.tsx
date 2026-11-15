/**
 * ROK-2207 — WoW: Forever hub dungeon planner. DEMO_MODE-gated, dev-only
 * wireframe so the operator can rule on the spec's open questions by looking
 * (spec `planning-artifacts/specs/ROK-2207.md`). Mocked data only.
 *
 * Gated like `HubPostsWireframesPage`: `useSystemStatus().demoMode`, redirect
 * to `/` when false, lazily imported from `lazy-routes.ts`.
 * Route: /dev/wireframes/dungeon-planner
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { Button } from '../../components/ui/button';
import { SchemeSwitcher, SideBySideToggle } from '../design-system/scheme-controls';
import { useForcedDarkRoot } from '../design-system/scheme-hooks';
import { DualFamily } from '../design-system/dual-family';
import { PlannerBody, PlannerWidget, type Layout } from './planner-view';
import { usePlannerState } from './use-planner-state';

function useDemoMode(): { ready: boolean; allowed: boolean } {
    const { data, isLoading } = useSystemStatus();
    if (isLoading) return { ready: false, allowed: false };
    return { ready: true, allowed: data?.demoMode === true };
}

/** A numbered decision frame with its options side by side. */
function Decision({ title, note, children }: { title: string; note: string; children: ReactNode }): JSX.Element {
    return (
        <section className="space-y-3 border-t border-edge pt-5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-secondary">{note}</p>
            <div className="grid gap-4 xl:grid-cols-2">{children}</div>
        </section>
    );
}

function Option({ label, children }: { label: string; children: ReactNode }): JSX.Element {
    return (
        <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            {children}
        </div>
    );
}

/** Desktop = full width; phone = a 390px column (layout passed explicitly, not via viewport). */
function Sized({ layout, children }: { layout: Layout; children: ReactNode }): JSX.Element {
    return <div className={layout === 'phone' ? 'w-[390px] max-w-full' : 'w-full'}>{children}</div>;
}

function MockTabs(): JSX.Element {
    const tabs = ['Overview', 'Raids', 'Dungeon planner', 'Crafters', 'Forum'];
    return (
        <div className="mb-2 flex gap-1 overflow-x-auto border-b border-edge text-sm">
            {tabs.map((t) => (
                <span key={t} className={`whitespace-nowrap px-3 py-2 ${t === 'Dungeon planner' ? 'border-b-2 border-success text-foreground' : 'text-muted'}`}>{t}</span>
            ))}
        </div>
    );
}

function Frames({ layout }: { layout: Layout }): JSX.Element {
    const a = usePlannerState(3);
    const b = usePlannerState(5);
    return (
        <div className="space-y-8">
            <Decision title="OQ1 — Tab or widget?" note="A tab has room for the quest breakdown and a URL a forum post can point at; a widget card cannot hold the breakdown.">
                <Option label="Option A (recommended) — hub tab"><Sized layout={layout}><MockTabs /><PlannerBody s={a} layout={layout} invite={false} /></Sized></Option>
                <Option label="Option B — Overview widget"><Sized layout={layout}><PlannerWidget s={a} /></Sized></Option>
            </Decision>
            <Decision title="OQ3 — Create-event buttons" note="Both link to /events/new with gameId, guildId and contentInstanceIds; Option B adds inviteCharacterIds. The real form reads only gameId today — it ignores the new params until the build.">
                <Option label="Option A (recommended) — pre-fill only"><Sized layout={layout}><PlannerBody s={b} layout={layout} invite={false} /></Sized></Option>
                <Option label="Option B — also invite the group"><Sized layout={layout}><PlannerBody s={b} layout={layout} invite /></Sized></Option>
            </Decision>
            <Decision title="Quest layout — grouped vs matrix" note="Grouped is the event page's format with a chip per character (new pattern); the matrix is the existing Dungeon quests widget table.">
                <Option label="Option A (recommended) — event-page grouping"><Sized layout={layout}><PlannerBody s={b} layout={layout} invite={false} /></Sized></Option>
                <Option label="Option B — QuestMatrix"><Sized layout={layout}><PlannerBody s={b} layout={layout} invite={false} questLayout="matrix" /></Sized></Option>
            </Decision>
        </div>
    );
}

function Intro(): JSX.Element {
    return (
        <header className="mb-5 border-b border-edge pb-3">
            <h1 className="text-xl font-semibold text-foreground">ROK-2207 — Dungeon planner (WoW: Forever hub)</h1>
            <p className="mt-1 text-sm text-secondary">
                Pick up to 5 characters and a dungeon; see level fit and the dungeon’s quests in the event page’s format, then
                copy a link for a forum post or create a pre-filled event. Mocked data only — nothing here talks to the API.
                Characters: Aelin (in range), Brann (chain prerequisites unmet), Corra (below range), Dorn (above range), Esk (no linked character).
            </p>
        </header>
    );
}

/** The ROK-2207 dungeon-planner wireframe page (DEMO_MODE only). */
export function DungeonPlannerWireframePage(): JSX.Element | null {
    const { ready, allowed } = useDemoMode();
    const [sideBySide, setSideBySide] = useState(false);
    const [layout, setLayout] = useState<Layout>('desktop');
    useForcedDarkRoot(sideBySide);
    if (!ready) return null;
    if (!allowed) return <Navigate to="/" replace />;
    const frames = <Frames layout={layout} />;
    return (
        <div className="mx-auto max-w-[1600px] px-4 py-6">
            <Intro />
            <div className="mb-6 flex flex-wrap items-center gap-3">
                <SchemeSwitcher />
                <SideBySideToggle active={sideBySide} onToggle={() => setSideBySide((v) => !v)} />
                <Button variant="secondary" size="sm" aria-pressed={layout === 'phone'}
                    onClick={() => setLayout((l) => (l === 'phone' ? 'desktop' : 'phone'))}>
                    {layout === 'phone' ? 'Show desktop width' : 'Show phone width (390px)'}
                </Button>
            </div>
            {sideBySide ? <DualFamily>{frames}</DualFamily> : frames}
        </div>
    );
}

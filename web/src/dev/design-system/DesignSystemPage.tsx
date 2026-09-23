/**
 * /dev/design-system — the rendered companion to `docs/design-system.md`
 * (ROK-1539). DEMO_MODE-gated exactly like the wireframe routes beside it.
 *
 * The doc is the reference an agent reads; this page is the one it looks at.
 * When they disagree, the running app is right and BOTH should be corrected.
 */
import { useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { TokensSection } from './tokens-section';
import { AccentsSection } from './accents-section';
import { PrimitivesSection } from './primitives-section';
import { OverlaysSection } from './overlays-section';
import { FilteringSection } from './filtering-section';
import { SemanticTokensSection } from './semantic-tokens-section';
import { HeroSection } from './hero-section';
import { WeekStripSection } from './week-strip-section';
import { GroupMarksSection } from './group-marks-section';
import { FormsSection } from './forms-section';
import { SchemeSwitcher, SideBySideToggle } from './scheme-controls';
import { useForcedDarkRoot } from './scheme-hooks';
import { DualFamily } from './dual-family';

const NAV = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'semantic', label: 'Semantic' },
    { id: 'accents', label: 'Accents' },
    { id: 'primitives', label: 'Primitives' },
    { id: 'forms', label: 'Forms' },
    { id: 'overlays', label: 'Overlays' },
    { id: 'filtering', label: 'Filtering' },
    { id: 'hero', label: 'Hero' },
    { id: 'week-strip', label: 'Week strip' },
    { id: 'group-marks', label: 'Group marks' },
];

function useDemoMode(): { ready: boolean; allowed: boolean } {
    const { data, isLoading } = useSystemStatus();
    if (isLoading) return { ready: false, allowed: false };
    return { ready: true, allowed: data?.demoMode === true };
}

function PageHeader(): JSX.Element {
    return (
        <header className="border-b border-edge pb-3 mb-6">
            <h1 className="text-xl font-semibold text-foreground">Raid Ledger — Design System</h1>
            <p className="text-sm text-secondary mt-1">
                Tokens, primitives and pattern rules as they actually ship. Read this before adding UI, so a
                new feature does not become a fourth way to do a job that already has one.
            </p>
            <p className="text-xs text-amber-300 mt-1">
                📄 Canonical doc: <code className="text-amber-200">docs/design-system.md</code> · Related wireframes:{' '}
                <code className="text-amber-200">/dev/wireframes/simplify</code>,{' '}
                <code className="text-amber-200">/dev/wireframes/lineup</code>
            </p>
            <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {NAV.map(({ id, label }) => (
                    <a key={id} href={`#${id}`} className="text-emerald-300 hover:text-emerald-200 underline">{label}</a>
                ))}
            </nav>
        </header>
    );
}

function Sections(): JSX.Element {
    return (
        <>
            <TokensSection />
            <SemanticTokensSection />
            <AccentsSection />
            <PrimitivesSection />
            <FormsSection />
            <OverlaysSection />
            <FilteringSection />
            <HeroSection />
            <WeekStripSection />
            <GroupMarksSection />
        </>
    );
}

/** Scheme picker + two-family toggle, with the note explaining what the toggle does. */
function Controls({ sideBySide, onToggle }: {
    sideBySide: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <div className="mb-6 flex flex-wrap items-center gap-3">
            <SchemeSwitcher />
            <SideBySideToggle active={sideBySide} onToggle={onToggle} />
            {sideBySide && (
                <p className="text-[11px] text-muted max-w-md" data-testid="ds-side-by-side-note">
                    The root is pinned to <code className="text-amber-400">default-dark</code> while this is on,
                    and your scheme comes back when you turn it off: the light tokens cascade into a scoped
                    wrapper, the dark ones are declared on the root only (docs/design-system.md §6.8).
                </p>
            )}
        </div>
    );
}

/** DEMO_MODE-gated design-system reference page. */
export function DesignSystemPage(): JSX.Element | null {
    const { ready, allowed } = useDemoMode();
    const [sideBySide, setSideBySide] = useState(false);
    useForcedDarkRoot(sideBySide);
    if (!ready) return null;
    if (!allowed) return <Navigate to="/" replace />;
    return (
        <div className="max-w-6xl mx-auto px-4 py-6">
            <PageHeader />
            <Controls sideBySide={sideBySide} onToggle={() => setSideBySide((v) => !v)} />
            {sideBySide ? <DualFamily><Sections /></DualFamily> : <Sections />}
        </div>
    );
}

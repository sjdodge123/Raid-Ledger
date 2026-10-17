/**
 * Journey hero for /dev/design-system (ROK-1586 §5.1, pattern §4.13).
 *
 * Mounts the REAL `JourneyHero` — never a re-drawing — once per tone, at a
 * phone width and a desktop width. The chip and the manage row are stubs: the
 * point is where the slots sit and how each tone keys the border and badge
 * (`action` = success, `waiting` = neutral edge, `set` = warning).
 */
import type { JSX } from 'react';
import { JourneyHero } from '../../components/shared/journey-hero';
import type { HeroTone, JourneyPhase } from '../../components/shared/journey-hero';
import { Section } from './design-system-bits';

interface HeroExample {
    tone: HeroTone;
    phase: JourneyPhase;
    badge: string;
    task: string;
    cta?: string;
    exitCondition?: string;
}

const HERO_EXAMPLES: HeroExample[] = [
    { tone: 'action', phase: 'voting', badge: 'Voting · your turn', task: 'Vote for up to 3 games', cta: 'Vote now' },
    { tone: 'waiting', phase: 'voting', badge: 'Voting · waiting on others', task: '4 of 6 members have voted',
        exitCondition: 'Voting closes Friday 8 PM' },
    { tone: 'set', phase: 'scheduling', badge: 'Scheduling · time set', task: 'Thursday 8 PM is locked in' },
];

const WIDTHS = [
    { id: 'phone', label: 'Phone — 375px', cls: 'max-w-[375px]' },
    { id: 'desktop', label: 'Desktop — full column', cls: 'max-w-3xl' },
];

/** Stand-in for the lineup's "Participants · N" roster button (the `action` chip slot). */
function StubChip(): JSX.Element {
    return <span className="px-2 py-0.5 text-[10px] rounded-full border border-edge text-muted">Participants · 6</span>;
}

/** Stand-in for the phone "Manage poll ⋯" row (the `manage` slot). */
function StubManage(): JSX.Element {
    return (
        <button type="button" className="w-full text-left text-xs text-muted border-t border-edge-subtle pt-2">
            Manage poll ⋯
        </button>
    );
}

function HeroAtWidth({ width }: { width: (typeof WIDTHS)[number] }): JSX.Element {
    return (
        <div data-testid={`ds-hero-${width.id}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">{width.label}</div>
            <div className={`flex flex-col gap-3 ${width.cls}`}>
                {HERO_EXAMPLES.map((ex) => (
                    <JourneyHero key={ex.tone} {...ex} onCtaClick={ex.cta ? () => undefined : undefined}
                        action={<StubChip />} manage={<StubManage />} />
                ))}
            </div>
        </div>
    );
}

/** The one shared hero, three tones, two widths. */
export function HeroSection(): JSX.Element {
    return (
        <Section
            id="hero"
            title="Pattern — journey hero"
            blurb="One shared component on every mount, phone and desktop: headline row, chip slot, 4px progress bar (the Lineup progress list semantics are kept), tone-keyed border and badge, a manage slot last."
        >
            <div className="flex flex-col gap-6">
                {WIDTHS.map((w) => <HeroAtWidth key={w.id} width={w} />)}
            </div>
        </Section>
    );
}

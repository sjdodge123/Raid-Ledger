/**
 * Hub `heroBanner` slot for /dev/design-system (ROK-1170, design-system §3.2
 * row + §4.7). A stand-in hero (the real `HubHero` needs a whole hub page and
 * query) carrying the REAL `FoundedPill`, with the REAL WoW guild-state banner
 * view directly under it: the member variant (copy only) and the editor
 * variant (+ "Update the guild path"). Flip "Side by side" for both families.
 */
import type { JSX } from 'react';
import { Pill } from '../../components/hub/hub-bits';
import { FoundedPill } from '../../plugins/wow/hub/wow-hero';
import { GuildStateBannerView } from '../../plugins/wow/hub/wow-guild-state-banner';
import { Section } from './design-system-bits';

const FOUNDED = '2024-03-05T18:30:00.000Z';

/** Stand-in for `HubHero`: name + the WoW hero pills, Founded among them. */
function StubHero(): JSX.Element {
    return (
        <header className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
            <h3 className="text-lg font-semibold text-foreground">Order of the Ember</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>Whitemane · US</span>
                <Pill tone="faction-horde">Horde</Pill>
                <FoundedPill foundedAt={FOUNDED} />
            </div>
        </header>
    );
}

function BannerVariant({ id, label, editor }: { id: string; label: string; editor: boolean }): JSX.Element {
    return (
        <div data-testid={`ds-hero-banner-${id}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">{label}</div>
            <div className="flex flex-col gap-3">
                <StubHero />
                <GuildStateBannerView onUpdate={editor ? () => undefined : null} />
            </div>
        </div>
    );
}

/** The slot under the hero, member and editor variants. */
export function HubHeroBannerSection(): JSX.Element {
    return (
        <Section
            id="hub-hero-banner"
            title="Pattern — hub hero banner"
            blurb="A hub module's optional heroBanner renders full width directly under the hero on every tab, and decides itself whether to show. WoW fills it with a persistent §4.7 warning status banner once Blizzard stops finding the guild; an editor also gets the warning-soft action. The hero's neutral Founded pill shows the month and year, the full date on hover."
        >
            <div className="flex flex-col gap-6 max-w-3xl">
                <BannerVariant id="member" label="Member — copy only" editor={false} />
                <BannerVariant id="editor" label="Editor — with the Update the guild path action" editor />
            </div>
        </Section>
    );
}

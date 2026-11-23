/**
 * Signed-out plugin public card page for /dev/design-system (ROK-1813,
 * design-system §4 pattern note). Mounts the REAL `PublicGuildCardView` in its
 * open (Apply shown) and closed (no Apply) states. Flip "Side by side" to check
 * both colour families. The live page adds `useNoIndex` and the single
 * not-found state; neither needs a demo.
 */
import type { JSX } from 'react';
import type { PublicGuildCard } from '@raid-ledger/contract';
import { PublicGuildCardView } from '../../plugins/wow/public-card/public-guild-card';
import { Section, StateFrame } from './design-system-bits';

const OPEN: PublicGuildCard = {
    name: 'Order of the Ember',
    region: 'US',
    realmName: null,
    gameName: 'WoW: Forever',
    approxMemberCount: 140,
    recruitment: {
        state: 'open',
        wanted: [
            { className: 'Priest', role: 'healer', state: 'open' },
            { className: 'Druid', role: 'tank', state: 'limited' },
        ],
        applyUrl: 'https://example.com/apply',
    },
};

const CLOSED: PublicGuildCard = { ...OPEN, name: 'Quiet Hollow', approxMemberCount: null, recruitment: null };

export function PublicGuildCardSection(): JSX.Element {
    return (
        <Section id="public-guild-card" title="Pattern — signed-out plugin public card"
            blurb="A plugin-owned page a signed-out visitor opens from a shared link: no back button, one card, read-only pills, Apply as a primary anchor, noindex.">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <StateFrame label="Recruiting — Apply shown (https only)"><PublicGuildCardView card={OPEN} /></StateFrame>
                <StateFrame label="Never set / closed — no Apply, fewer than 10 members"><PublicGuildCardView card={CLOSED} /></StateFrame>
            </div>
        </Section>
    );
}

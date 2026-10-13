/**
 * ROK-1778: public privacy policy at `/privacy` — outside the AuthGuard and
 * chromeless (Layout `isChromelessPath`), because Google's OAuth consent
 * screen links here and its reviewers open it logged out.
 *
 * Copy lives in `privacy/privacy-copy.tsx`. The community name comes from the
 * public system status (falls back to "this community"), and so does the
 * optional admin-set contact email; without one, the page points at the Discord.
 */
import type { JSX } from 'react';
import { useSystemStatus } from '../hooks/use-system-status';
import {
    COMMUNITY_FALLBACK, PRIVACY_LAST_UPDATED, buildPrivacySections,
    type PrivacyFeatures, type PrivacySection,
} from './privacy/privacy-copy';

/**
 * Neither Calendar Sync's kill switch nor the AI provider is on the public
 * system status, so a logged-out visitor cannot tell whether they are on.
 * Their disclosures therefore always render (over-disclosing is the safe side).
 */
const PUBLIC_FEATURES: PrivacyFeatures = { calendar: true, ai: true };

function SectionView({ section }: { section: PrivacySection }): JSX.Element {
    const headingId = `privacy-${section.id}`;
    return (
        <section aria-labelledby={headingId} className="mt-8">
            <h2 id={headingId} className="text-lg font-semibold text-foreground border-b border-edge pb-2 mb-3">
                {section.heading}
            </h2>
            {section.paragraphs?.map((p) => <p key={p.key} className="mt-2">{p.content}</p>)}
            {section.bullets && (
                <ul className="list-disc pl-5 space-y-2">
                    {section.bullets.map((b) => <li key={b.key}>{b.content}</li>)}
                </ul>
            )}
        </section>
    );
}

export function PrivacyPage(): JSX.Element {
    const { data: status } = useSystemStatus();
    const name = status?.communityName?.trim();
    const community = name ? name : COMMUNITY_FALLBACK;
    const contactEmail = status?.privacyContactEmail ?? null;
    const sections = buildPrivacySections({ community, contactEmail }, PUBLIC_FEATURES);
    return (
        <div className="px-4 py-8 sm:py-12">
            <article className="max-w-prose mx-auto bg-surface border border-edge rounded-lg p-5 sm:p-8 text-sm sm:text-base text-secondary leading-relaxed break-words"
                data-testid="privacy-policy">
                <h1 className="text-2xl font-bold text-foreground">Privacy policy: {community}</h1>
                {sections.map((s) => <SectionView key={s.id} section={s} />)}
                <p className="mt-8 text-xs text-muted">Last updated: {PRIVACY_LAST_UPDATED}</p>
            </article>
        </div>
    );
}

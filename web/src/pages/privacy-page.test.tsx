/**
 * ROK-1778: the public `/privacy` page. It renders from the public system
 * status alone — no auth hook is involved, so a logged-out visitor sees it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { SystemStatusDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../test/render-helpers';
import { PrivacyPage } from './privacy-page';
import {
    GOOGLE_USER_DATA_POLICY_URL, PRIVACY_LAST_UPDATED, buildPrivacySections,
} from './privacy/privacy-copy';

const status = vi.hoisted(() => {
    const s: { current: Partial<SystemStatusDto> | undefined } = { current: undefined };
    return s;
});
vi.mock('../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: status.current }) }));

function renderPage() {
    renderWithProviders(<PrivacyPage />, { initialEntries: ['/privacy'] });
    return screen.getByTestId('privacy-policy');
}

describe('PrivacyPage', () => {
    beforeEach(() => { status.current = undefined; });

    it('names the community from the public system status', () => {
        status.current = { communityName: 'Night Owls' };
        const page = renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy policy: Night Owls');
        expect(page).toHaveTextContent("Night Owls's admins run it and are responsible for your data here.");
    });

    it('falls back to "this community" before the status loads, capitalised at a sentence start', () => {
        const page = renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy policy: this community');
        expect(page).toHaveTextContent("This community's admins run it");
    });

    it('carries the Google Limited Use sentence and links the User Data Policy', () => {
        const page = renderPage();
        expect(page).toHaveTextContent(
            'will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
        );
        expect(within(page).getByRole('link', { name: 'Google API Services User Data Policy' }))
            .toHaveAttribute('href', GOOGLE_USER_DATA_POLICY_URL);
        expect(page).toHaveTextContent(`Last updated: ${PRIVACY_LAST_UPDATED}`);
    });

    it('discloses Sentry error reports when the status flag is absent', () => {
        const page = renderPage();
        expect(page).toHaveTextContent('Error reports.');
        expect(page).toHaveTextContent("sent to the Raid Ledger developers' error tracker, Sentry");
        expect(page).toHaveTextContent('we strip usernames, email addresses and IP addresses wherever they can be detected');
        expect(page).toHaveTextContent('we remove the secrets that appear in web addresses, headers and sign-in links from the report and from feedback you send');
        // ROK-1838 r3: the copy must still name what is NOT scrubbed.
        expect(page).toHaveTextContent('One thing this does not cover:');
        expect(page).toHaveTextContent('a screenshot you attach is sent exactly as captured, so anything visible in it is sent too');
        // ROK-1839: the sign-in token is stripped from the address bar before
        // Sentry starts, so the page-address carve-out is gone for good.
        expect(page).not.toHaveTextContent('the page address stored with a session recording can still contain a sign-in link');
        expect(page).not.toHaveTextContent('Two things this does not cover:');
        expect(page).toHaveTextContent("Error reports are on by default, and this site's admins can turn them off.");
    });

    it('discloses error reports when the instance reports telemetry on (ROK-1779)', () => {
        status.current = { telemetryEnabled: true };
        expect(renderPage()).toHaveTextContent('Error reports.');
    });

    it('omits error reports when the instance opted out of telemetry (ROK-1838)', () => {
        status.current = { telemetryEnabled: false };
        const page = renderPage();
        expect(page).not.toHaveTextContent('Error reports');
        expect(page).not.toHaveTextContent('Sentry');
    });

    it('discloses feedback screenshots and page context, and that feedback goes to Sentry (ROK-1313)', () => {
        const page = renderPage();
        expect(page).toHaveTextContent(
            'Feedback you send: your message and, if you add one, a screenshot, plus the page address, your screen size, browser and app version (and, for bug reports, recent browser console logs).',
        );
        expect(page).toHaveTextContent('Feedback you send, including any screenshot you attach, also goes to Sentry.');
    });

    it('offers the admin-set contact email and the Discord route', () => {
        status.current = { communityName: 'Night Owls', privacyContactEmail: 'privacy@example.com' };
        const contact = within(renderPage()).getByRole('region', { name: 'Contact' });
        expect(within(contact).getByRole('link', { name: 'privacy@example.com' }))
            .toHaveAttribute('href', 'mailto:privacy@example.com');
        expect(contact).toHaveTextContent(
            "Questions or deletion requests: privacy@example.com, or ask an admin in Night Owls's Discord server.",
        );
    });

    it('without a contact email, points only at the Discord', () => {
        status.current = { communityName: 'Night Owls', privacyContactEmail: null };
        const contact = within(renderPage()).getByRole('region', { name: 'Contact' });
        expect(within(contact).queryByRole('link')).not.toBeInTheDocument();
        expect(contact).toHaveTextContent(
            "Questions or deletion requests: ask an admin in Night Owls's Discord server.",
        );
    });
});

describe('buildPrivacySections — feature-conditional disclosures', () => {
    const ctx = { community: 'Night Owls', contactEmail: null };
    const bulletKeys = (features: { calendar: boolean; ai: boolean; telemetry: boolean }) =>
        buildPrivacySections(ctx, features).find((s) => s.id === 'who-else')?.bullets?.map((b) => b.key);

    it('drops the Google Calendar section and the Google + AI bullets while those features are off', () => {
        const ids = buildPrivacySections(ctx, { calendar: false, ai: false, telemetry: true }).map((s) => s.id);
        expect(ids).not.toContain('google-calendar');
        expect(bulletKeys({ calendar: false, ai: false, telemetry: true })).toEqual(['discord', 'errors', 'games']);
    });

    it('keeps them while the features are on', () => {
        const ids = buildPrivacySections(ctx, { calendar: true, ai: true, telemetry: true }).map((s) => s.id);
        expect(ids).toContain('google-calendar');
        expect(bulletKeys({ calendar: true, ai: true, telemetry: true }))
            .toEqual(['discord', 'google', 'errors', 'ai', 'games']);
    });

    it('drops the errors bullet while telemetry is off (ROK-1779)', () => {
        expect(bulletKeys({ calendar: true, ai: true, telemetry: false })).toEqual(['discord', 'google', 'ai', 'games']);
    });
});

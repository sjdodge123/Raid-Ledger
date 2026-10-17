/**
 * ROK-1830 S5b — the onboarding-dismissal hook: one query for every prompt,
 * an optimistic dismiss, and a rollback that puts the prompt back when the
 * write fails.
 */
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { useHubOnboarding } from './use-hub-onboarding';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL = 'http://localhost:3000/guilds/onboarding';
const EMPTY: HubOnboardingStateDto = { dismissed: [] };

function Probe({ guildId = null }: { guildId?: number | null }): JSX.Element {
    const prompt = useHubOnboarding('hub-setup-checklist', guildId);
    return (
        <div>
            <span data-testid="visible">{prompt.visible ? 'yes' : 'no'}</span>
            <span data-testid="failed">{prompt.failed ? 'yes' : 'no'}</span>
            <button type="button" onClick={prompt.dismiss}>Dismiss</button>
        </div>
    );
}

/** Two prompts sharing one cache entry — the interleaving Codex reproduced. */
function TwoPrompts(): JSX.Element {
    const card = useHubOnboarding('players-get-your-guild', null);
    const checklist = useHubOnboarding('hub-setup-checklist', 7);
    return (
        <div>
            <span data-testid="card-visible">{card.visible ? 'yes' : 'no'}</span>
            <span data-testid="checklist-visible">{checklist.visible ? 'yes' : 'no'}</span>
            <button type="button" onClick={card.dismiss}>Dismiss card</button>
            <button type="button" onClick={checklist.dismiss}>Dismiss checklist</button>
        </div>
    );
}

describe('useHubOnboarding', () => {
    it('is visible once the state comes back without this prompt', async () => {
        server.use(http.get(URL, () => HttpResponse.json(EMPTY)));
        renderWithProviders(<Probe />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('yes'));
    });

    it('stays hidden when the server already holds the dismissal for this scope', async () => {
        server.use(http.get(URL, () => HttpResponse.json({
            dismissed: [{ key: 'hub-setup-checklist', guildId: 7, dismissedAt: '2026-10-01T00:00:00.000Z' }],
        } satisfies HubOnboardingStateDto)));
        renderWithProviders(<Probe guildId={7} />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('no'));
        // A dismissal of the SAME key in another scope must not hide this one.
        expect(screen.getByTestId('failed')).toHaveTextContent('no');
    });

    it('a per-hub dismissal leaves the same key in another hub visible', async () => {
        server.use(http.get(URL, () => HttpResponse.json({
            dismissed: [{ key: 'hub-setup-checklist', guildId: 9, dismissedAt: '2026-10-01T00:00:00.000Z' }],
        } satisfies HubOnboardingStateDto)));
        renderWithProviders(<Probe guildId={7} />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('yes'));
    });

    it('dismiss hides the prompt before the POST answers and keeps it hidden after', async () => {
        let release = (): void => undefined;
        const posted = new Promise<void>((resolve) => { release = resolve; });
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            http.post(`${URL}/hub-setup-checklist/dismiss`, async () => {
                await posted;
                return HttpResponse.json({ dismissed: [{ key: 'hub-setup-checklist', guildId: null, dismissedAt: '2026-10-02T00:00:00.000Z' }] } satisfies HubOnboardingStateDto);
            }),
        );
        renderWithProviders(<Probe />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('yes'));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('no'));
        release();
        await waitFor(() => expect(screen.getByTestId('failed')).toHaveTextContent('no'));
        expect(screen.getByTestId('visible')).toHaveTextContent('no');
    });

    it('a failed dismiss rolls back — the prompt comes back and says so', async () => {
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            http.post(`${URL}/hub-setup-checklist/dismiss`, () => HttpResponse.json({ message: 'nope' }, { status: 500 })),
        );
        renderWithProviders(<Probe />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('yes'));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        await waitFor(() => expect(screen.getByTestId('failed')).toHaveTextContent('yes'));
        expect(screen.getByTestId('visible')).toHaveTextContent('yes');
    });

    it('sends the guild scope as a query parameter, never in the path', async () => {
        const urls: string[] = [];
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            http.post(`${URL}/hub-setup-checklist/dismiss`, ({ request }) => {
                urls.push(request.url);
                return HttpResponse.json(EMPTY);
            }),
        );
        renderWithProviders(<Probe guildId={7} />);
        await waitFor(() => expect(screen.getByTestId('visible')).toHaveTextContent('yes'));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        await waitFor(() => expect(urls).toHaveLength(1));
        expect(urls[0]).toBe(`${URL}/hub-setup-checklist/dismiss?guildId=7`);
    });

    // Codex P2 (PR-3): the rollback used to restore the WHOLE cache snapshot
    // taken when the failing mutation started, which silently undid a sibling
    // prompt's dismissal that had succeeded in the meantime.
    it('a failed dismiss leaves another prompt successful dismissal alone', async () => {
        let releaseCard: () => void = () => {};
        const cardPosted = new Promise<void>((resolve) => { releaseCard = resolve; });
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            // The card's dismiss starts FIRST and fails LAST.
            http.post(`${URL}/players-get-your-guild/dismiss`, async () => {
                await cardPosted;
                return HttpResponse.json({ message: 'nope' }, { status: 500 });
            }),
            http.post(`${URL}/hub-setup-checklist/dismiss`, () => HttpResponse.json({
                dismissed: [{ key: 'hub-setup-checklist', guildId: 7, dismissedAt: '2026-10-02T00:00:00.000Z' }],
            } satisfies HubOnboardingStateDto)),
        );
        renderWithProviders(<TwoPrompts />);
        await waitFor(() => expect(screen.getByTestId('card-visible')).toHaveTextContent('yes'));

        await userEvent.click(screen.getByRole('button', { name: 'Dismiss card' }));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }));
        await waitFor(() => expect(screen.getByTestId('checklist-visible')).toHaveTextContent('no'));

        releaseCard();
        // The card comes back (its write failed) …
        await waitFor(() => expect(screen.getByTestId('card-visible')).toHaveTextContent('yes'));
        // … and the checklist, whose write SUCCEEDED, stays dismissed.
        expect(screen.getByTestId('checklist-visible')).toHaveTextContent('no');
    });
});

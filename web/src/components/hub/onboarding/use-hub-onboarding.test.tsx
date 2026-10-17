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
const AT = '2026-10-02T00:00:00.000Z';
const CHECKLIST_ROW = { key: 'hub-setup-checklist', guildId: 7, dismissedAt: AT } as const;
const WITNESS_ROW = { key: 'hub-setup-checklist', guildId: 9, dismissedAt: AT } as const;
const CARD_ROW = { key: 'players-get-your-guild', guildId: null, dismissedAt: AT } as const;

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

/** A prompt rendered twice — two hook instances racing the SAME (key, guildId). */
function SamePairTwice(): JSX.Element {
    const a = useHubOnboarding('hub-setup-checklist', 7);
    const b = useHubOnboarding('hub-setup-checklist', 7);
    const witness = useHubOnboarding('players-get-your-guild', null);
    return (
        <div>
            <span data-testid="a-visible">{a.visible ? 'yes' : 'no'}</span>
            <span data-testid="a-failed">{a.failed ? 'yes' : 'no'}</span>
            <span data-testid="b-visible">{b.visible ? 'yes' : 'no'}</span>
            <span data-testid="witness-visible">{witness.visible ? 'yes' : 'no'}</span>
            <button type="button" onClick={a.dismiss}>Dismiss A</button>
            <button type="button" onClick={b.dismiss}>Dismiss B</button>
        </div>
    );
}

/**
 * Two pairs plus a witness the server dismisses on its own — the witness going
 * away proves the sibling's response reached the cache, so the assertion that
 * follows is about a cache the response has already been merged into.
 */
function SiblingPrompts(): JSX.Element {
    const card = useHubOnboarding('players-get-your-guild', null);
    const checklist = useHubOnboarding('hub-setup-checklist', 7);
    const witness = useHubOnboarding('hub-setup-checklist', 9);
    return (
        <div>
            <span data-testid="card-visible">{card.visible ? 'yes' : 'no'}</span>
            <span data-testid="checklist-visible">{checklist.visible ? 'yes' : 'no'}</span>
            <span data-testid="witness-visible">{witness.visible ? 'yes' : 'no'}</span>
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
    // PR-3 review MINOR: `onSuccess` used to install the response wholesale.
    // The server only knows the rows it had when it answered, so a sibling
    // prompt's still-pending optimistic dismissal was wiped and its card
    // flashed back on screen until its own write replied.
    it('a sibling success merges, so a still-pending dismissal is not wiped', async () => {
        let releaseCard: () => void = () => {};
        const cardPosted = new Promise<void>((resolve) => { releaseCard = resolve; });
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            http.post(`${URL}/players-get-your-guild/dismiss`, async () => {
                await cardPosted;
                return HttpResponse.json({ dismissed: [CARD_ROW, CHECKLIST_ROW, WITNESS_ROW] } satisfies HubOnboardingStateDto);
            }),
            // Answers first, and knows nothing about the card's row.
            http.post(`${URL}/hub-setup-checklist/dismiss`, () => HttpResponse.json({
                dismissed: [CHECKLIST_ROW, WITNESS_ROW],
            } satisfies HubOnboardingStateDto)),
        );
        renderWithProviders(<SiblingPrompts />);
        await waitFor(() => expect(screen.getByTestId('card-visible')).toHaveTextContent('yes'));

        await userEvent.click(screen.getByRole('button', { name: 'Dismiss card' }));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }));
        // Nothing dismissed guild 9 optimistically, so this flips only once the
        // checklist's RESPONSE is in the cache.
        await waitFor(() => expect(screen.getByTestId('witness-visible')).toHaveTextContent('no'));

        expect(screen.getByTestId('card-visible'), 'the card\'s write is still in flight — its row must survive the sibling response').toHaveTextContent('no');
        releaseCard();
        await waitFor(() => expect(screen.getByTestId('card-visible')).toHaveTextContent('no'));
    });

    // Codex P2 (PR-3): two writes for the SAME pair. The older one recorded
    // "I added this entry" and, on failing, removed it — even though a newer
    // write had already had it stored by the server.
    it('an older failed dismiss cannot undo a newer confirmed one for the same prompt', async () => {
        let releaseFirst: () => void = () => {};
        const firstPosted = new Promise<void>((resolve) => { releaseFirst = resolve; });
        let calls = 0;
        server.use(
            http.get(URL, () => HttpResponse.json(EMPTY)),
            http.post(`${URL}/hub-setup-checklist/dismiss`, async () => {
                calls += 1;
                if (calls === 1) {
                    await firstPosted;
                    return HttpResponse.json({ message: 'nope' }, { status: 500 });
                }
                return HttpResponse.json({ dismissed: [CHECKLIST_ROW, CARD_ROW] } satisfies HubOnboardingStateDto);
            }),
        );
        renderWithProviders(<SamePairTwice />);
        await waitFor(() => expect(screen.getByTestId('a-visible')).toHaveTextContent('yes'));

        await userEvent.click(screen.getByRole('button', { name: 'Dismiss A' }));
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss B' }));
        // The card row is only ever server-sent, so this proves B's response landed.
        await waitFor(() => expect(screen.getByTestId('witness-visible')).toHaveTextContent('no'));

        releaseFirst();
        await waitFor(() => expect(screen.getByTestId('a-failed')).toHaveTextContent('yes'));
        expect(screen.getByTestId('a-visible'), 'the server stored B\'s dismissal — A failing later must not undo it').toHaveTextContent('no');
        expect(screen.getByTestId('b-visible')).toHaveTextContent('no');
    });
});

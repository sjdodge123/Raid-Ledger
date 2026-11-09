/**
 * ROK-2149 — the read-only roster member's "Claim this character" CTA. Codex P2:
 * until the viewer's characters have loaded, "no characters" is unknown, so a
 * claim then would go out as `isMain: true` with the default ruleset and could
 * demote the real main. The CTA stays disabled until the list loads, and a
 * failed list shows an error line instead of reading as empty.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { CharacterDetailReadOnlyActions } from './character-detail-read-only-actions';

const API_BASE = 'http://localhost:3000';
const CHARACTERS_URL = `${API_BASE}/users/me/characters`;
const CLAIM_URL = `${API_BASE}/plugins/wow/roster-claim/members/:memberId/claim`;

/** Counts claim POSTs so a test can prove none went out. */
function spyOnClaims(): { count: () => number } {
    let calls = 0;
    server.use(http.post(CLAIM_URL, () => {
        calls += 1;
        return HttpResponse.json({ message: 'unexpected claim' }, { status: 500 });
    }));
    return { count: () => calls };
}

function renderCta(): void {
    renderWithProviders(<CharacterDetailReadOnlyActions rosterMemberId={11} canClaim fromClaim={false} gameId={7} name="Ashen Vale" />);
}

describe('CharacterDetailReadOnlyActions — claim CTA waits for the viewer\'s characters (ROK-2149)', () => {
    it('keeps the CTA disabled while the characters load, and a click sends no claim', async () => {
        server.use(http.get(CHARACTERS_URL, async () => { await delay('infinite'); return HttpResponse.json({ data: [], meta: { total: 0 } }); }));
        const claims = spyOnClaims();
        renderCta();
        const cta = screen.getByRole('button', { name: 'Claim this character' });
        expect(cta).toBeDisabled();
        await userEvent.click(cta);
        expect(claims.count()).toBe(0);
    });

    it('shows an error line and keeps the CTA disabled when the characters fail to load', async () => {
        server.use(http.get(CHARACTERS_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const claims = spyOnClaims();
        renderCta();
        expect(await screen.findByTestId('roster-member-claim-error')).toBeInTheDocument();
        const cta = screen.getByRole('button', { name: 'Claim this character' });
        expect(cta).toBeDisabled();
        await userEvent.click(cta);
        expect(claims.count()).toBe(0);
    });

    it('enables the CTA once the characters have loaded', async () => {
        renderCta();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Claim this character' })).toBeEnabled());
        expect(screen.queryByTestId('roster-member-claim-error')).not.toBeInTheDocument();
    });
});

/** ROK-1636: a failed realm list must say so, not render an empty dropdown. */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { RealmAutocomplete } from './realm-autocomplete';

const REALMS_URL = 'http://localhost:3000/blizzard/realms';

function renderAutocomplete() {
    return renderWithProviders(<RealmAutocomplete region="us" value="" onChange={() => {}} gameVariant="classic_era" />);
}

describe('RealmAutocomplete — realm load errors (ROK-1636)', () => {
    it("shows the API's message when the realm list returns 502", async () => {
        server.use(http.get(REALMS_URL, () => HttpResponse.json(
            { statusCode: 502, message: 'Blizzard realm list is unavailable right now.' }, { status: 502 })));
        renderAutocomplete();
        expect((await screen.findByRole('alert')).textContent).toBe('Blizzard realm list is unavailable right now.');
    });

    it('falls back to a generic line when the error body carries no message', async () => {
        server.use(http.get(REALMS_URL, () => HttpResponse.json({ statusCode: 502 }, { status: 502 })));
        renderAutocomplete();
        expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load realms for this region.");
    });

    it('shows no error when realms load', async () => {
        server.use(http.get(REALMS_URL, () => HttpResponse.json({ data: [{ id: 1, name: 'Whitemane', slug: 'whitemane' }] })));
        renderAutocomplete();
        await screen.findByRole('textbox');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

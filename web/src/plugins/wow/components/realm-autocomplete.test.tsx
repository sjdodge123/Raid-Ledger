/**
 * ROK-1636: a failed realm list must say so, not render an empty dropdown.
 * ROK-1654: the realm field is the shared Combobox — keyboard pick, free text, no popup chrome.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { Field } from '../../../components/ui/field';
import { RealmAutocomplete } from './realm-autocomplete';

const REALMS_URL = 'http://localhost:3000/blizzard/realms';
const REALMS = ['Whitemane', 'Whisperwind', 'Stormrage'].map((name, i) => ({ id: i + 1, name, slug: name.toLowerCase() }));

function realmsLoad() {
    server.use(http.get(REALMS_URL, () => HttpResponse.json({ data: REALMS })));
}

/** Mounted the way the Armory import form mounts it: controlled, inside a Field. */
function Harness({ onChange }: { onChange: (realm: string) => void }) {
    const [value, setValue] = useState('');
    return (
        <Field label="Realm">
            <RealmAutocomplete region="us" value={value} onChange={(v) => { setValue(v); onChange(v); }} gameVariant="classic_era" />
        </Field>
    );
}

function renderAutocomplete(onChange: (realm: string) => void = () => {}) {
    return renderWithProviders(<Harness onChange={onChange} />);
}

const realmInput = () => screen.findByRole('combobox', { name: /realm/i });

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
        await realmInput();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('RealmAutocomplete — shared Combobox (ROK-1654)', () => {
    it('picks a realm from the keyboard', async () => {
        realmsLoad();
        const onChange = vi.fn();
        const user = userEvent.setup();
        renderAutocomplete(onChange);
        const input = await realmInput();
        await user.type(input, 'whi');
        expect(input).toHaveAttribute('aria-expanded', 'true');
        await screen.findByRole('option', { name: 'Whitemane' });
        expect(screen.queryByRole('option', { name: 'Stormrage' })).not.toBeInTheDocument();
        await user.keyboard('{ArrowDown}');
        const activeId = input.getAttribute('aria-activedescendant') ?? '';
        expect(document.getElementById(activeId)).toHaveTextContent('Whitemane');
        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenLastCalledWith('Whitemane');
        expect(input).toHaveValue('Whitemane');
        expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('passes a free-typed realm through verbatim', async () => {
        realmsLoad();
        const onChange = vi.fn();
        const user = userEvent.setup();
        renderAutocomplete(onChange);
        const input = await realmInput();
        await user.type(input, 'Nonexistent Realm');
        expect(onChange).toHaveBeenLastCalledWith('Nonexistent Realm');
        expect(input).toHaveValue('Nonexistent Realm');
    });

    it('keeps the text when the user types on after a pick', async () => {
        realmsLoad();
        const onChange = vi.fn();
        const user = userEvent.setup();
        renderAutocomplete(onChange);
        const input = await realmInput();
        await user.type(input, 'storm');
        await screen.findByRole('option', { name: 'Stormrage' });
        await user.keyboard('{ArrowDown}{Enter}');
        expect(input).toHaveValue('Stormrage');
        await user.type(input, 'x');
        expect(input).toHaveValue('Stormragex');
        expect(onChange).toHaveBeenLastCalledWith('Stormragex');
    });

    it('drops the old popup chrome: no Realm Name header, no realm-count footer (ruling 15)', async () => {
        realmsLoad();
        const user = userEvent.setup();
        renderAutocomplete();
        await user.click(screen.getByPlaceholderText('Realm Name'));
        await screen.findByRole('option', { name: 'Whitemane' });
        expect(screen.queryByText('Realm Name')).not.toBeInTheDocument();
        expect(screen.queryByText(/\d+ realms?/)).not.toBeInTheDocument();
    });
});

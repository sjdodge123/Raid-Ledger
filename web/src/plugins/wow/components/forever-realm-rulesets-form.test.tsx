/**
 * ROK-1739: the admin realm → ruleset editor — rows, add/remove, inline
 * duplicate/blank errors from the contract schema, the PUT body, and the
 * load/save error states.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { toast } from '../../../lib/toast';
import { ForeverRealmRulesetsSection } from './forever-realm-rulesets-form';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const URL = 'http://localhost:3000/admin/plugins/blizzard/forever/realm-rulesets';
const SAVED = { entries: [{ region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' }] };

let puts: unknown[] = [];

function serve(saved: unknown = SAVED): void {
    server.use(
        http.get(URL, () => HttpResponse.json(saved)),
        http.put(URL, async ({ request }) => {
            const body = await request.json();
            puts.push(body);
            return HttpResponse.json(body);
        }),
    );
}

beforeEach(() => {
    puts = [];
    vi.clearAllMocks();
});

const saveButton = () => screen.getByRole('button', { name: /save realm rulesets/i });

describe('ForeverRealmRulesetsSection (ROK-1739)', () => {
    it('renders the saved rows with region, realm name and ruleset', async () => {
        serve();
        renderWithProviders(<ForeverRealmRulesetsSection />);
        expect(await screen.findByRole('textbox', { name: 'Realm name, row 1' })).toHaveValue('Bloodmoon');
        expect(screen.getByRole('combobox', { name: 'Region, row 1' })).toHaveValue('us');
        expect(screen.getByRole('combobox', { name: 'Ruleset, row 1' })).toHaveValue('pvp');
        expect(screen.getByRole('heading', { name: 'Realm rulesets' })).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();
    });

    it('shows the empty state when no realm is mapped', async () => {
        serve({ entries: [] });
        renderWithProviders(<ForeverRealmRulesetsSection />);
        expect(await screen.findByText(/no realms mapped yet/i)).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('Add realm appends a blank row and Remove drops a row', async () => {
        const user = userEvent.setup();
        serve();
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await screen.findByRole('textbox', { name: 'Realm name, row 1' });
        await user.click(screen.getByRole('button', { name: /add realm/i }));
        expect(screen.getByRole('textbox', { name: 'Realm name, row 2' })).toHaveValue('');
        expect(screen.getByRole('combobox', { name: 'Ruleset, row 2' })).toHaveValue('normal');
        await user.click(screen.getByRole('button', { name: 'Remove Bloodmoon' }));
        expect(screen.getAllByRole('textbox')).toHaveLength(1);
        expect(screen.getByRole('textbox', { name: 'Realm name, row 1' })).toHaveValue('');
    });

    it('flags a case/whitespace-insensitive duplicate in the same region inline and sends nothing', async () => {
        const user = userEvent.setup();
        serve();
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await screen.findByRole('textbox', { name: 'Realm name, row 1' });
        await user.click(screen.getByRole('button', { name: /add realm/i }));
        const second = screen.getByRole('textbox', { name: 'Realm name, row 2' });
        await user.type(second, '  bloodMOON ');
        await user.click(saveButton());
        const row2 = second.closest('li');
        if (!row2) throw new Error('row 2 is not rendered in a list item');
        expect(within(row2).getByRole('alert')).toHaveTextContent('Duplicate realm for this region');
        expect(second).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('accepts the same realm name in another region', async () => {
        const user = userEvent.setup();
        serve();
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await screen.findByRole('textbox', { name: 'Realm name, row 1' });
        await user.click(screen.getByRole('button', { name: /add realm/i }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Region, row 2' }), 'eu');
        await user.type(screen.getByRole('textbox', { name: 'Realm name, row 2' }), 'Bloodmoon');
        await user.click(saveButton());
        await waitFor(() => expect(puts).toHaveLength(1));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('blocks a blank realm name with an inline error', async () => {
        const user = userEvent.setup();
        serve({ entries: [] });
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await user.click(await screen.findByRole('button', { name: /add realm/i }));
        await user.type(screen.getByRole('textbox', { name: 'Realm name, row 1' }), '   ');
        await user.click(saveButton());
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter the realm name');
        expect(puts).toEqual([]);
    });
});

describe('ForeverRealmRulesetsSection — save (ROK-1739)', () => {
    it('PUTs the whole list with trimmed names and toasts success', async () => {
        const user = userEvent.setup();
        serve();
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await screen.findByRole('textbox', { name: 'Realm name, row 1' });
        await user.click(screen.getByRole('button', { name: /add realm/i }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Region, row 2' }), 'eu');
        await user.type(screen.getByRole('textbox', { name: 'Realm name, row 2' }), '  Nightslayer  ');
        await user.selectOptions(screen.getByRole('combobox', { name: 'Ruleset, row 2' }), 'hardcore');
        await user.click(saveButton());
        await waitFor(() => expect(puts).toEqual([{ entries: [
            { region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' },
            { region: 'eu', realmName: 'Nightslayer', ruleset: 'hardcore' },
        ] }]));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Realm rulesets saved'));
    });

    it('toasts the server message when the save is rejected', async () => {
        const user = userEvent.setup();
        serve();
        server.use(http.put(URL, () => HttpResponse.json({ message: 'Duplicate realm for this region' }, { status: 400 })));
        renderWithProviders(<ForeverRealmRulesetsSection />);
        await user.click(await screen.findByRole('button', { name: 'Remove Bloodmoon' }));
        await user.click(saveButton());
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/duplicate realm/i)));
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows an inline error when the saved list cannot be loaded', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderWithProviders(<ForeverRealmRulesetsSection />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load the realm list/i);
        expect(screen.queryByRole('button', { name: /save realm rulesets/i })).not.toBeInTheDocument();
    });
});

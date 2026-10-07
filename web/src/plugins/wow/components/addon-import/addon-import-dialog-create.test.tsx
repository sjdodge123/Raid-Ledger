/**
 * ROK-1738 — the addon import dialog in `mode="create"` (Add Character's
 * "Import LedgerLink character"): the create/update target banner, the D13
 * ruleset picker and its Import gate, the request body, the inline error
 * banner, the stacked phone sheet, `onCreated` with no result step, and the
 * filler wiring that closes Add Character and lands on the character page.
 * The per-character mode is checked to be unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { activateWowPlugin } from '../../../../test/activate-wow-plugin';
import { Z_INDEX } from '../../../../lib/z-index';
import { toast } from '../../../../lib/toast';
import { PluginSlot } from '../../../plugin-slot';
import { AddonImportDialog } from './addon-import-dialog';
import { CHARACTER_ID, CHAR_STRING, CREATED_ID, IMPORT_URL, NEW_IMPORT_URL, charResult, newCharResult } from './addon-import.test-fixtures';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));
vi.mock('../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const originalMatchMedia = window.matchMedia;

function mockViewportWidth(width: number): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        return {
            matches: !!min && width >= Number(min[1]), media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        };
    }) as unknown as typeof window.matchMedia;
}

interface Reply { status: number; body: unknown }
type Body = { dryRun: boolean; ruleset?: string };
const APPLIED = newCharResult({ characterId: CREATED_ID }, { status: 'applied' });

/** One handler for both create-route calls, branching on `dryRun`; returns every request body. */
function mockCreate(preview: Reply, apply: Reply = { status: 200, body: APPLIED }, url = NEW_IMPORT_URL) {
    const bodies: Body[] = [];
    server.use(http.post(url, async ({ request }) => {
        const body = await request.json() as Body;
        bodies.push(body);
        const reply = body.dryRun ? preview : apply;
        return HttpResponse.json(reply.body as Record<string, unknown>, { status: reply.status });
    }));
    return bodies;
}

const preview = (target: Parameters<typeof newCharResult>[0] = {}): Reply => ({ status: 200, body: newCharResult(target) });

function renderCreate() {
    const onCreated = vi.fn();
    renderWithProviders(<AddonImportDialog mode="create" isOpen={true} onClose={vi.fn()} onCreated={onCreated} />);
    return { onCreated };
}

async function pasteAndCheck(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Export string/), CHAR_STRING);
    await user.click(screen.getByRole('button', { name: 'Check string' }));
    await screen.findByRole('button', { name: 'Import' });
}

beforeEach(() => { mockViewportWidth(1280); navigate.mockClear(); vi.mocked(toast.success).mockClear(); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('AddonImportDialog create mode — target banner', () => {
    it('previews a create target, then hands the applied result to onCreated with no result step', async () => {
        const bodies = mockCreate(preview());
        const user = userEvent.setup();
        const { onCreated } = renderCreate();
        expect(screen.getByRole('heading', { name: 'Import LedgerLink character' })).toBeInTheDocument();
        await pasteAndCheck(user);
        const banner = screen.getByTestId('addon-import-target');
        expect(banner).toHaveAttribute('data-action', 'create');
        expect(banner).toHaveTextContent('Creates Ana · US · Normal · Level 60 Paladin');
        expect(screen.queryByTestId('addon-import-ruleset-picker')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
        expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ target: { characterId: CREATED_ID } });
        expect(bodies.map((b) => b.dryRun)).toEqual([true, false]);
        expect(bodies[1]).not.toHaveProperty('ruleset');
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });

    it('says an own character will be updated, with no picker', async () => {
        mockCreate(preview({ action: 'update', characterId: CREATED_ID, name: 'Ana' }));
        const user = userEvent.setup();
        renderCreate();
        await pasteAndCheck(user);
        const banner = screen.getByTestId('addon-import-target');
        expect(banner).toHaveAttribute('data-action', 'update');
        expect(banner).toHaveTextContent('Already on your account — this will update Ana');
        expect(screen.queryByTestId('addon-import-ruleset-picker')).toBeNull();
    });
});

describe('AddonImportDialog create mode — ruleset picker (D13)', () => {
    it('asks for a ruleset with nothing picked and no Hardcore, and gates Import until one is chosen', async () => {
        const bodies = mockCreate(preview({ ruleset: null }));
        const user = userEvent.setup();
        renderCreate();
        await pasteAndCheck(user);
        expect(screen.getByTestId('addon-import-target')).toHaveTextContent('· ruleset not in export ·');
        const picker = within(screen.getByRole('radiogroup', { name: 'Ruleset' }));
        expect(picker.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Normal', 'PvP', 'Roleplaying']);
        expect(picker.queryByRole('radio', { checked: true })).toBeNull();
        expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
        await user.click(picker.getByRole('radio', { name: 'PvP' }));
        expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[0]).not.toHaveProperty('ruleset');
        expect(bodies[1]).toMatchObject({ dryRun: false, ruleset: 'pvp' });
    });

    it('shows RULESET_REQUIRED as the inline danger banner with the picker still there — never a toast', async () => {
        mockCreate(preview({ ruleset: null }), { status: 422, body: { code: 'RULESET_REQUIRED', message: 'pick' } });
        const user = userEvent.setup();
        const { onCreated } = renderCreate();
        await pasteAndCheck(user);
        await user.click(screen.getByRole('radio', { name: 'Normal' }));
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByTestId('addon-import-error')).toHaveTextContent('Choose a ruleset');
        expect(screen.getByTestId('addon-import-ruleset-picker')).toBeInTheDocument();
        expect(onCreated).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows CHARACTER_CLAIMED as the inline danger banner on the preview step', async () => {
        mockCreate(preview(), { status: 422, body: { code: 'CHARACTER_CLAIMED', message: 'taken' } });
        const user = userEvent.setup();
        renderCreate();
        await pasteAndCheck(user);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByTestId('addon-import-error')).toHaveTextContent('Already claimed');
    });
});

describe('AddonImportDialog frames', () => {
    const layer = () => screen.getByRole('dialog').parentElement as HTMLElement;

    it('create mode on a phone lifts the sheet to the Modal layer (stacked over Add Character)', () => {
        mockViewportWidth(375);
        renderCreate();
        expect(screen.getByTestId('bottom-sheet-footer')).toBeInTheDocument();
        expect(layer().style.zIndex).toBe(String(Z_INDEX.MODAL));
    });

    it('character mode is unchanged: own route, "Import string", unstacked sheet, result step, no target banner', async () => {
        mockViewportWidth(375);
        const bodies = mockCreate({ status: 200, body: charResult() }, { status: 200, body: charResult({ status: 'applied' }) }, IMPORT_URL);
        const user = userEvent.setup();
        renderWithProviders(<AddonImportDialog isOpen={true} onClose={vi.fn()} characterId={CHARACTER_ID} gameId={7} />);
        expect(screen.getByRole('heading', { name: 'Import string' })).toBeInTheDocument();
        expect(layer().style.zIndex).toBe(String(Z_INDEX.BOTTOM_SHEET));
        await pasteAndCheck(user);
        expect(screen.queryByTestId('addon-import-target')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
        expect(bodies.every((b) => !('ruleset' in b))).toBe(true);
    });
});

describe('Import LedgerLink character filler → create dialog', () => {
    beforeEach(() => activateWowPlugin());

    it('opens the create dialog and, on import, closes Add Character, toasts and lands on the character page', async () => {
        mockCreate(preview());
        const onClose = vi.fn();
        const user = userEvent.setup();
        renderWithProviders(<PluginSlot name="character-create:header-actions" context={{ onClose, gameSlug: '' }} />);
        await user.click(screen.getByRole('button', { name: /Import LedgerLink character/ }));
        expect(screen.getByRole('heading', { name: 'Import LedgerLink character' })).toBeInTheDocument();
        await pasteAndCheck(user);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/characters/${CREATED_ID}`));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});

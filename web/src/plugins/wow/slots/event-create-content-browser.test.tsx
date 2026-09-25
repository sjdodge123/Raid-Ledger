/**
 * ROK-1654 (H5): the WoW content browser sits on the shared form primitives —
 * the search is a SearchInput (placeholder unchanged; a smoke spec selects it),
 * instances are Checkbox rows in a group named by the Dungeons/Raids heading,
 * and each chip's remove control is a named ghost icon Button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useWowInstances } from '../hooks/use-wow-instances';
import { fetchWowInstanceDetail } from '../api-client';
import { EventCreateContentBrowser } from './event-create-content-browser';

vi.mock('../../../hooks/use-system-status', () => ({ useSystemStatus: vi.fn() }));
vi.mock('../hooks/use-wow-instances', () => ({ useWowInstances: vi.fn() }));
vi.mock('../api-client', () => ({ fetchWowInstanceDetail: vi.fn() }));

const DEADMINES: WowInstanceDto = { id: 1, name: 'The Deadmines', shortName: 'DM', expansion: 'Classic', minimumLevel: 15, maximumLevel: 21 };
const CAVERNS: WowInstanceDto = { id: 2, name: 'Wailing Caverns', shortName: 'WC', expansion: 'Classic', minimumLevel: 15, maximumLevel: 25 };
const SHADOWFANG: WowInstanceDto = { id: 3, name: 'Shadowfang Keep', expansion: 'Classic', minimumLevel: null };

function detail(inst: WowInstanceDto): WowInstanceDetailDto {
    return { ...inst, minimumLevel: inst.minimumLevel ?? null, maxPlayers: null, category: 'dungeon' };
}

function mockHooks(blizzardConfigured = true): void {
    vi.mocked(useSystemStatus).mockReturnValue({ data: { blizzardConfigured } } as unknown as ReturnType<typeof useSystemStatus>);
    vi.mocked(useWowInstances).mockReturnValue(
        { data: { data: [DEADMINES, CAVERNS, SHADOWFANG] }, isLoading: false } as unknown as ReturnType<typeof useWowInstances>,
    );
}

function renderBrowser(selected: WowInstanceDetailDto[] = []) {
    const onInstancesChange = vi.fn();
    render(<EventCreateContentBrowser wowVariant="classic_era" contentType="dungeon"
        selectedInstances={selected} onInstancesChange={onInstancesChange} />);
    return onInstancesChange;
}

beforeEach(() => { vi.clearAllMocks(); mockHooks(); });

describe('EventCreateContentBrowser — search (ROK-1654 H5)', () => {
    it('is a named searchbox that keeps the smoke placeholder', () => {
        renderBrowser();
        expect(screen.getByRole('searchbox', { name: 'Search dungeons' })).toHaveAttribute('placeholder', 'Search dungeons...');
    });

    it('filters the checkbox rows as the user types', async () => {
        const user = userEvent.setup();
        renderBrowser();
        const group = screen.getByRole('group', { name: 'Dungeons' });
        expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
        await user.type(screen.getByRole('searchbox', { name: 'Search dungeons' }), 'deadm');
        expect(within(group).getAllByRole('checkbox')).toHaveLength(1);
        expect(within(group).getByRole('checkbox', { name: 'The Deadmines' })).not.toBeChecked();
    });
});

describe('EventCreateContentBrowser — instance rows (ROK-1654 H5)', () => {
    it('checking an instance with a known level appends it', async () => {
        const user = userEvent.setup();
        const onChange = renderBrowser([detail(CAVERNS)]);
        const group = screen.getByRole('group', { name: 'Dungeons' });
        expect(within(group).getByRole('checkbox', { name: 'Wailing Caverns' })).toBeChecked();
        await user.click(within(group).getByRole('checkbox', { name: 'The Deadmines' }));
        expect(onChange).toHaveBeenCalledWith([detail(CAVERNS), detail(DEADMINES)]);
    });

    it('disables the row and says Loading… while its detail fetch runs', async () => {
        vi.mocked(fetchWowInstanceDetail).mockReturnValue(new Promise(() => {}));
        const user = userEvent.setup();
        renderBrowser();
        const box = screen.getByRole('checkbox', { name: 'Shadowfang Keep' });
        await user.click(box);
        expect(box).toBeDisabled();
        expect(box).toHaveAccessibleDescription('Loading…');
    });
});

describe('EventCreateContentBrowser — chips (ROK-1654 H5)', () => {
    it('the named remove button drops only that instance', async () => {
        const user = userEvent.setup();
        const onChange = renderBrowser([detail(DEADMINES), detail(CAVERNS)]);
        await user.click(screen.getByRole('button', { name: 'Remove The Deadmines' }));
        expect(onChange).toHaveBeenCalledWith([detail(CAVERNS)]);
    });

    it('paints no raw emerald/amber/white hue', () => {
        renderBrowser([detail(DEADMINES)]);
        const raw = [...document.querySelectorAll('[class]')]
            .map((el) => el.getAttribute('class') ?? '')
            .filter((c) => /emerald-|amber-|text-white/.test(c));
        expect(raw).toEqual([]);
    });
});

describe('EventCreateContentBrowser — Blizzard not configured (ROK-1654 H5)', () => {
    it('shows the notice and no searchbox', () => {
        mockHooks(false);
        renderBrowser();
        expect(screen.getByText(/Blizzard API not configured/)).toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.getByText('Dungeons', { exact: true })).toBeInTheDocument();
    });
});

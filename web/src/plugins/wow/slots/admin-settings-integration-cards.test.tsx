import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlizzardIntegrationSlot } from './admin-settings-integration-cards';

vi.mock('../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const mockBlizzardStatus = {
    data: null as null | { configured: boolean },
    isLoading: false,
};
const mockUpdateBlizzard = { mutateAsync: vi.fn(), isPending: false };
const mockTestBlizzard = { mutateAsync: vi.fn(), isPending: false };
const mockClearBlizzard = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../../hooks/use-admin-settings', () => ({
    useAdminSettings: () => ({
        blizzardStatus: mockBlizzardStatus,
        updateBlizzard: mockUpdateBlizzard,
        testBlizzard: mockTestBlizzard,
        clearBlizzard: mockClearBlizzard,
    }),
}));

vi.mock('../../../hooks/use-new-badge', () => ({
    useNewBadge: () => ({ isNew: false, markSeen: vi.fn() }),
}));

function resetMocks() {
    vi.clearAllMocks();
    mockBlizzardStatus.data = null;
    for (const m of [mockUpdateBlizzard, mockTestBlizzard, mockClearBlizzard]) {
        m.isPending = false;
        m.mutateAsync = vi.fn();
    }
}

function renderConfigured() {
    mockBlizzardStatus.data = { configured: true };
    return render(<BlizzardIntegrationSlot />);
}

/**
 * ROK-1652 ruling 7: a pending button is Button `loading` — aria-disabled +
 * aria-busy (focus stays) and it swallows clicks. Each case below also clicks
 * the button and proves the mutation never fires.
 */
function expectLoading(btn: HTMLElement) {
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
}

describe('BlizzardIntegrationSlot — credential fields', () => {
    beforeEach(resetMocks);

    it('names Client ID by its label and keeps the blizzardClientId id', () => {
        render(<BlizzardIntegrationSlot />);
        const input = screen.getByRole('textbox', { name: 'Client ID' });
        expect(input).toHaveAttribute('id', 'blizzardClientId');
    });

    it('names Client Secret by its label, keeps the blizzardClientSecret id and hides it', () => {
        render(<BlizzardIntegrationSlot />);
        const input = screen.getByLabelText('Client Secret') as HTMLInputElement;
        expect(input).toHaveAttribute('id', 'blizzardClientSecret');
        expect(input.type).toBe('password');
    });

    it('"Show Client Secret" points at the secret input and flips its type', () => {
        render(<BlizzardIntegrationSlot />);
        const input = screen.getByLabelText('Client Secret') as HTMLInputElement;
        const toggle = screen.getByRole('button', { name: 'Show Client Secret' });
        expect(toggle).toHaveAttribute('aria-controls', 'blizzardClientSecret');
        fireEvent.click(toggle);
        expect(input.type).toBe('text');
        fireEvent.click(screen.getByRole('button', { name: 'Hide Client Secret' }));
        expect(input.type).toBe('password');
    });

    it('renders nothing for another plugin slug', () => {
        const { container } = render(<BlizzardIntegrationSlot pluginSlug="other" />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('BlizzardIntegrationSlot — Save', () => {
    beforeEach(resetMocks);

    it('Save calls the save handler with both credentials', async () => {
        mockUpdateBlizzard.mutateAsync = vi.fn().mockResolvedValue({ success: true, message: 'Saved' });
        render(<BlizzardIntegrationSlot />);
        fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'my-id' } });
        fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'my-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
        await waitFor(() => expect(mockUpdateBlizzard.mutateAsync)
            .toHaveBeenCalledWith({ clientId: 'my-id', clientSecret: 'my-secret' }));
    });

    it('Save is primary lg flex-1', () => {
        render(<BlizzardIntegrationSlot />);
        const btn = screen.getByRole('button', { name: 'Save Configuration' });
        expect(btn.className).toContain('flex-1');
        expect(btn.className).not.toMatch(/bg-blue-/);
    });

    it('Save is loading and swallows the submit while pending', () => {
        mockUpdateBlizzard.isPending = true;
        render(<BlizzardIntegrationSlot />);
        fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'my-id' } });
        fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'my-secret' } });
        const btn = screen.getByRole('button', { name: 'Saving...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockUpdateBlizzard.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('BlizzardIntegrationSlot — Test and Clear while pending', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.restoreAllMocks());

    it('Test Connection is loading and swallows the click while pending', () => {
        mockTestBlizzard.isPending = true;
        renderConfigured();
        const btn = screen.getByRole('button', { name: 'Testing...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockTestBlizzard.mutateAsync).not.toHaveBeenCalled();
    });

    it('Clear is loading and swallows the click while pending', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockClearBlizzard.isPending = true;
        renderConfigured();
        const btn = screen.getByRole('button', { name: 'Clear' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockClearBlizzard.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('BlizzardIntegrationSlot — test result and theme tokens', () => {
    beforeEach(resetMocks);

    it('shows a successful test result on the success token', async () => {
        mockTestBlizzard.mutateAsync = vi.fn().mockResolvedValue({ success: true, message: 'Blizzard OK' });
        renderConfigured();
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        const banner = await screen.findByText('Blizzard OK');
        expect(banner.className).toContain('bg-success/10');
        expect(banner.className).toContain('text-success');
    });

    it('shows a failed test result on the danger token', async () => {
        mockTestBlizzard.mutateAsync = vi.fn().mockResolvedValue({ success: false, message: 'Blizzard down' });
        renderConfigured();
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        const banner = await screen.findByText('Blizzard down');
        expect(banner.className).toContain('bg-danger/10');
        expect(banner.className).toContain('text-danger');
    });

    it('the setup callout is the neutral panel', () => {
        render(<BlizzardIntegrationSlot />);
        const callout = screen.getByText('Setup Instructions:').closest('div') as HTMLElement;
        expect(callout.className).toContain('bg-overlay/30');
        expect(callout.className).toContain('border-edge');
    });

    it('keeps only the brand tile hex and no raw palette hues in the card body', () => {
        const { container } = renderConfigured();
        const classesIn = (root: Element) => Array.from(root.querySelectorAll('[class]'))
            .map((el) => el.getAttribute('class') ?? '').join(' ');
        // Ruling 9: the brand logo tile is the one hex this file keeps.
        expect(classesIn(container).match(/\[#[0-9A-Fa-f]{3,8}\]/g) ?? []).toEqual(['[#148EFF]']);
        // The card body is everything this file renders below the shared IntegrationCard header.
        // Buttons are skipped: the Button primitive owns its variant paint (design-system §2.2).
        const body = container.querySelector('form')?.parentElement as HTMLElement;
        const bodyClasses = Array.from(body.querySelectorAll('[class]'))
            .filter((el) => el.closest('button') === null)
            .map((el) => el.getAttribute('class') ?? '').join(' ');
        expect(bodyClasses).not.toMatch(/-(blue|emerald|red)-\d{3}/);
    });
});

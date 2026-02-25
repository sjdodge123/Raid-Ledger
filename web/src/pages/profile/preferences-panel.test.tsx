/**
 * Unit tests for the consolidated PreferencesPanel (ROK-359).
 * Verifies it renders both Appearance and Timezone sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreferencesPanel } from './preferences-panel';

// Mock AppearancePanel with a identifiable output
vi.mock('./appearance-panel', () => ({
    AppearancePanel: () => <div data-testid="appearance-panel">Appearance Content</div>,
}));

// Mock TimezoneSection with a identifiable output
vi.mock('../../components/profile/TimezoneSection', () => ({
    TimezoneSection: () => <div data-testid="timezone-section">Timezone Content</div>,
}));

describe('PreferencesPanel (ROK-359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the AppearancePanel sub-component', () => {
        render(<PreferencesPanel />);
        expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
    });

    it('renders the TimezoneSection sub-component', () => {
        render(<PreferencesPanel />);
        expect(screen.getByTestId('timezone-section')).toBeInTheDocument();
    });

    it('renders Appearance section before Timezone section in the DOM', () => {
        const { container } = render(<PreferencesPanel />);
        const appearance = container.querySelector('[data-testid="appearance-panel"]');
        const timezone = container.querySelector('[data-testid="timezone-section"]');
        expect(appearance).not.toBeNull();
        expect(timezone).not.toBeNull();
        // Appearance should appear before Timezone in document order
        expect(
            appearance!.compareDocumentPosition(timezone!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});

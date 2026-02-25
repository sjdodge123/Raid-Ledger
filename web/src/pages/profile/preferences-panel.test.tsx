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

    it('renders both sections together in a single panel', () => {
        render(<PreferencesPanel />);
        expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
        expect(screen.getByTestId('timezone-section')).toBeInTheDocument();
    });
});

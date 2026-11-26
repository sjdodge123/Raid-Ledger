/**
 * ROK-2357 — the invite page's WoW armory import is the `invite:character-import`
 * plugin slot: it shows only while `blizzard` is active, and with WoW off the
 * step falls back to the manual role picker with no import offered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { usePluginStore } from '../../stores/plugin-store';
import { CharacterStep, type CharacterStepProps } from './invite-character-step';

vi.mock('../../plugins/wow/components/wow-armory-import-form', () => ({
    WowArmoryImportForm: ({ defaultRealm }: { defaultRealm?: string }) => (
        <div data-testid="wow-import-form">{defaultRealm}</div>
    ),
}));

function props(overrides: Partial<CharacterStepProps> = {}): CharacterStepProps {
    return {
        stepLabels: ['Sign in', 'Character', 'Done'], totalSteps: 3, eventHeader: <h2>Raid night</h2>,
        hasRoles: true, shouldShowCharacterSelector: false, shouldShowImportForm: true,
        characters: [], selectedCharacterId: null, selectedRole: null, characterRole: null, isClaiming: false,
        gameInfo: { gameVariant: 'classic_era', inviterRealm: 'Mirage Raceway' },
        onSelectCharacter: vi.fn(), onSelectRole: vi.fn(), onClaim: vi.fn(),
        onShowImportForm: vi.fn(), onShowManualRoleSelector: vi.fn(), onImportSuccess: vi.fn(),
        ...overrides,
    };
}

function wowOff(): void {
    usePluginStore.setState({ activeSlugs: new Set([CORE_PLUGIN_ID]), initialized: true });
}

describe('CharacterStep — WoW import slot (ROK-2357)', () => {
    beforeEach(() => activateWowPlugin());

    it('shows the armory import form with the inviter realm while WoW is active', () => {
        render(<CharacterStep {...props()} />);
        expect(screen.getByTestId('wow-import-form')).toHaveTextContent('Mirage Raceway');
        expect(screen.getByText('Import your character to auto-detect your role')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Skip, choose role manually' })).toBeInTheDocument();
    });

    it('shows no import form and offers the manual role picker while WoW is off', () => {
        wowOff();
        render(<CharacterStep {...props()} />);
        expect(screen.queryByTestId('wow-import-form')).not.toBeInTheDocument();
        expect(screen.queryByText('Import your character to auto-detect your role')).not.toBeInTheDocument();
        expect(screen.getByText('Select your role for this event')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Event' })).toBeDisabled();
    });

    it('offers "Import another character" in the selector only while WoW is active', () => {
        const selector = props({ shouldShowCharacterSelector: true, shouldShowImportForm: false });
        const { unmount } = render(<CharacterStep {...selector} />);
        expect(screen.getByRole('button', { name: 'Import another character' })).toBeInTheDocument();
        unmount();
        wowOff();
        render(<CharacterStep {...selector} />);
        expect(screen.getByText('Select a character for this event')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Import another character' })).not.toBeInTheDocument();
    });
});

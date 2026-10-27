import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { PluginSetupRequirement } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { PELICAN_SERVER_ROWS_URL, PluginSetupRowBody } from './plugin-setup-row-body';

/** A minimal requirement; each test overrides the fields it exercises. */
function makeReq(overrides: Partial<PluginSetupRequirement> = {}): PluginSetupRequirement {
    return {
        id: 'step',
        kind: 'server_mod',
        title: 'Install the mod',
        instructions: '1. Do the thing.',
        required: true,
        ...overrides,
    };
}

function renderRow(req: PluginSetupRequirement): void {
    renderWithProviders(<PluginSetupRowBody req={req} />);
}

/** ROK-1969 §3.5 — an expanded setup row (L4 review: L4-1, L4-2). */
describe('PluginSetupRowBody', () => {
    it('shows "Where it goes on the server" with the egg hint, files and variable', () => {
        renderRow(makeReq({
            pelican: { eggHint: 'BepInEx egg', files: ['BepInEx/config/RaidLedger.ValheimLink.cfg'], variable: 'RL_LINK_TOKEN' },
        }));
        expect(screen.getByText('Where it goes on the server')).toBeInTheDocument();
        expect(screen.getByText('BepInEx egg')).toBeInTheDocument();
        expect(screen.getByText('BepInEx/config/RaidLedger.ValheimLink.cfg').tagName).toBe('CODE');
        expect(screen.getByText('RL_LINK_TOKEN').tagName).toBe('CODE');
    });

    it('omits "Where it goes" and "Apply on Pelican" without a pelican hint', () => {
        renderRow(makeReq());
        expect(screen.queryByText('Where it goes on the server')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Apply on Pelican' })).toBeNull();
    });

    it('a server_secret with a variable shows the VAR = placeholder line and the Issue token link', () => {
        renderRow(makeReq({ kind: 'server_secret', pelican: { variable: 'RL_LINK_TOKEN' } }));
        const secret = screen.getByTestId('setup-secret');
        expect(secret).toHaveTextContent('RL_LINK_TOKEN = <shown once when you issue it>');
        expect(screen.getByRole('link', { name: 'Issue token…' })).toHaveAttribute('href', PELICAN_SERVER_ROWS_URL);
    });

    it('a server_secret with only files shows the generic config placeholder', () => {
        renderRow(makeReq({ kind: 'server_secret', pelican: { files: ['config.cfg'] } }));
        expect(screen.getByTestId('setup-secret')).toHaveTextContent('<config block — shown once when you issue the token>');
    });

    it('L4-1: a server_secret with no pelican hint shows no "Issue token…" link', () => {
        renderRow(makeReq({ kind: 'server_secret' }));
        expect(screen.getByTestId('setup-secret')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Issue token…' })).toBeNull();
    });

    it('renders setup links as external links opening in a new tab', () => {
        renderRow(makeReq({ links: [{ label: 'Mod page', url: 'https://example.com/mod' }] }));
        const link = screen.getByRole('link', { name: 'Mod page ↗' });
        expect(link).toHaveAttribute('href', 'https://example.com/mod');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders no link list when the row has no links', () => {
        renderRow(makeReq());
        expect(screen.queryAllByRole('link')).toHaveLength(0);
    });
});

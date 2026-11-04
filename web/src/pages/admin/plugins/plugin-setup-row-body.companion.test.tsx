/** ROK-2056 AC8/AC9 — Setup rows the Raid Ledger Companion fulfils link to the players' install card. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { PluginSetupRequirement } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { PluginSetupRowBody } from './plugin-setup-row-body';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/companion-install')>()),
    companionDownloadAvailable: () => flag.on,
}));

const companionReq: PluginSetupRequirement = {
    id: 'upload-saves', kind: 'companion_app', title: 'Players install the Companion',
    instructions: '1. Install it.', required: true, rlCompanion: { collector: 'bg3-save' },
};

beforeEach(() => { flag.on = true; });

describe('PluginSetupRowBody — Companion rows (ROK-2056)', () => {
    it('an rlCompanion row links "How players install it" to the Companion card', () => {
        renderWithProviders(<PluginSetupRowBody req={companionReq} />);
        expect(screen.getByRole('link', { name: 'How players install it' }))
            .toHaveAttribute('href', '/profile/integrations#companion');
    });

    it('a companion_app row without rlCompanion (LedgerLink addon) gets no link', () => {
        const addon: PluginSetupRequirement = {
            id: 'ledgerlink-addon', kind: 'companion_app', title: 'Install LedgerLink', instructions: '1. Install it.', required: false,
        };
        renderWithProviders(<PluginSetupRowBody req={addon} />);
        expect(screen.queryByRole('link', { name: 'How players install it' })).toBeNull();
    });

    it('renders no link while the download is unavailable', () => {
        flag.on = false;
        renderWithProviders(<PluginSetupRowBody req={companionReq} />);
        expect(screen.queryByRole('link', { name: 'How players install it' })).toBeNull();
        expect(screen.getByText('Install it.')).toBeInTheDocument();
    });
});

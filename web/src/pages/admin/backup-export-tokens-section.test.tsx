/**
 * ROK-2263 — Admin → Backups "Clone access tokens": list / empty / error,
 * mint shows the plaintext once and drops it on close, revoke sends DELETE,
 * and the live cap disables "New token" (and a racing 409 is explained).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MintBackupExportTokenRequest } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { clearAccessToken, setAccessToken } from '../../lib/api/access-token-store';
import {
    FAKE_BACKUP_EXPORT_TOKEN,
    backupExportTokenMintCapHandler,
    backupExportTokenMintHandler,
    backupExportTokenRevokeHandler,
    backupExportTokensListErrorHandler,
    backupExportTokensListHandler,
    buildBackupExportToken,
} from '../../test/mocks/backup-export-token-handlers';
import { BackupExportTokensSection } from './backup-export-tokens-section';

vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
    setAccessToken('test-admin-jwt');
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});
afterEach(() => { window.matchMedia = originalMatchMedia; clearAccessToken(); });

function renderSection() {
    const user = userEvent.setup();
    const client = createTestQueryClient();
    render(<QueryClientProvider client={client}><BackupExportTokensSection /></QueryClientProvider>);
    return { user, client };
}

const ROWS = [
    buildBackupExportToken({ id: 1, label: 'Laptop', tokenHint: 'aaaa', lastUsedAt: '2026-11-10T08:00:00.000Z' }),
    buildBackupExportToken({ id: 2, label: 'Old laptop', tokenHint: 'bbbb', expiresAt: '2020-01-01T00:00:00.000Z' }),
    buildBackupExportToken({ id: 3, label: 'Retired CI', tokenHint: 'cccc', revokedAt: '2026-11-05T00:00:00.000Z', createdBy: null }),
];

describe('BackupExportTokensSection — list states', () => {
    it('lists each token with its hint and live / expired / revoked status; only live rows can be revoked', async () => {
        server.use(backupExportTokensListHandler(ROWS));
        renderSection();
        const rows = await screen.findAllByTestId('backup-export-token-row');
        expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['live', 'expired', 'revoked']);
        expect(rows[0]).toHaveTextContent('…aaaa');
        expect(rows[0]).toHaveTextContent('Created by admin');
        expect(rows[2]).toHaveTextContent('Created by a removed user');
        expect(rows.map((r) => within(r).queryByRole('button', { name: 'Revoke' }) !== null)).toEqual([true, false, false]);
        expect(screen.getByText('Lets a script download backups from this server. It cannot restore, delete or reset.')).toBeInTheDocument();
    });

    it('shows the empty state when no token exists', async () => {
        server.use(backupExportTokensListHandler([]));
        renderSection();
        expect(await screen.findByTestId('backup-export-token-empty')).toHaveTextContent('No clone access tokens yet.');
    });

    it('shows an error when the list fails to load', async () => {
        server.use(backupExportTokensListErrorHandler());
        renderSection();
        expect(await screen.findByTestId('backup-export-token-error')).toHaveTextContent('Failed to load clone access tokens.');
    });
});

describe('BackupExportTokensSection — mint', () => {
    it('sends the label and expiry, shows the token once, and drops it from the DOM on close', async () => {
        const seen: MintBackupExportTokenRequest[] = [];
        server.use(backupExportTokensListHandler([]), backupExportTokenMintHandler(seen));
        const { user, client } = renderSection();
        await screen.findByTestId('backup-export-token-empty');
        await user.click(screen.getByTestId('backup-export-token-new'));
        const form = await screen.findByRole('dialog', { name: 'New clone access token' });
        expect(within(form).getByRole('combobox', { name: 'Expires' })).toHaveValue('90');
        await user.type(within(form).getByRole('textbox', { name: /Label/ }), '  Laptop clone  ');
        await user.selectOptions(within(form).getByRole('combobox', { name: 'Expires' }), 'never');
        await user.click(screen.getByTestId('backup-export-token-mint-submit'));

        const shown = await screen.findByRole('dialog', { name: 'Clone access token created' });
        expect(seen).toEqual([{ label: 'Laptop clone', expiresInDays: null }]);
        expect(screen.queryByRole('dialog', { name: 'New clone access token' })).not.toBeInTheDocument();
        expect(within(shown).getByTestId('backup-export-token-secret-value')).toHaveValue(FAKE_BACKUP_EXPORT_TOKEN);

        await user.click(within(shown).getByRole('button', { name: 'Copy token' }));
        await user.click(within(shown).getByRole('button', { name: 'Done' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body.innerHTML).not.toContain(FAKE_BACKUP_EXPORT_TOKEN);
        // The plaintext must not outlive component state in React Query's mutation cache.
        await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data)))
            .not.toContain(FAKE_BACKUP_EXPORT_TOKEN));
    });

    it('explains a 409 cap refusal inside the mint form', async () => {
        server.use(backupExportTokensListHandler([]), backupExportTokenMintCapHandler());
        const { user } = renderSection();
        await screen.findByTestId('backup-export-token-empty');
        await user.click(screen.getByTestId('backup-export-token-new'));
        const form = await screen.findByRole('dialog', { name: 'New clone access token' });
        await user.type(within(form).getByRole('textbox', { name: /Label/ }), 'Sixth');
        await user.click(screen.getByTestId('backup-export-token-mint-submit'));
        expect(await within(form).findByRole('alert')).toHaveTextContent('You already have 5 live tokens. Revoke one before making another.');
    });

    it('disables "New token" with a hint once 5 tokens are live (expired / revoked do not count)', async () => {
        const live = [1, 2, 3, 4, 5].map((id) => buildBackupExportToken({ id, label: `T${id}` }));
        server.use(backupExportTokensListHandler([...live, ...ROWS.slice(1).map((r, i) => ({ ...r, id: 10 + i }))]));
        renderSection();
        await screen.findAllByTestId('backup-export-token-row');
        await waitFor(() => expect(screen.getByTestId('backup-export-token-new')).toBeDisabled());
        expect(screen.getByTestId('backup-export-token-cap-hint')).toHaveTextContent('5 live tokens is the limit. Revoke one to make another.');
    });

    it('keeps "New token" enabled below the cap', async () => {
        server.use(backupExportTokensListHandler(ROWS));
        renderSection();
        await screen.findAllByTestId('backup-export-token-row');
        expect(screen.getByTestId('backup-export-token-new')).toBeEnabled();
        expect(screen.queryByTestId('backup-export-token-cap-hint')).not.toBeInTheDocument();
    });
});

describe('BackupExportTokensSection — revoke', () => {
    it('confirms, then sends DELETE for that token', async () => {
        const revoked: number[] = [];
        server.use(backupExportTokensListHandler(ROWS), backupExportTokenRevokeHandler(revoked));
        const { user } = renderSection();
        const [liveRow] = await screen.findAllByTestId('backup-export-token-row');
        if (!liveRow) throw new Error('no token row rendered');
        await user.click(within(liveRow).getByRole('button', { name: 'Revoke' }));
        const confirm = await screen.findByRole('dialog', { name: 'Revoke clone access token' });
        expect(confirm).toHaveTextContent('…aaaa');
        expect(revoked).toEqual([]);
        await user.click(screen.getByTestId('backup-export-token-revoke-confirm'));
        await waitFor(() => expect(revoked).toEqual([1]));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Revoke clone access token' })).not.toBeInTheDocument());
    });
});

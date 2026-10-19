/** Mod-side setup notes in the Valheim Link token dialog (ROK-1833 follow-up). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValheimModInstructions } from './valheim-mod-instructions';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const RUNBOOK = 'https://github.com/Raid-Ledger-Plugins/rl-valheim-link/blob/main/docs/operations.md';

describe('ValheimModInstructions', () => {
    it('shows the [RaidLedger] block with the origin BaseUrl and the server id', () => {
        render(<ValheimModInstructions serverId="7" />);
        const block = screen.getByTestId('valheim-link-config-block');
        expect(block).toHaveTextContent('[RaidLedger]');
        expect(block).toHaveTextContent(`BaseUrl = ${window.location.origin}`);
        expect(block.textContent).not.toContain(`${window.location.origin}/\n`);
        expect(block).toHaveTextContent('ServerId = 7');
    });

    it('uses a placeholder for ServerToken when no token is supplied', () => {
        render(<ValheimModInstructions serverId="7" />);
        expect(screen.getByTestId('valheim-link-config-block')).toHaveTextContent('ServerToken = <paste the token here>');
    });

    it('copies the block with the real token substituted when one is supplied', async () => {
        const user = userEvent.setup();
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        render(<ValheimModInstructions serverId="7" token="vl_secret_abc" />);
        await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
        await waitFor(async () => expect(await navigator.clipboard.readText()).toContain('ServerToken = vl_secret_abc'));
    });

    it('reports a successful block copy to the caller (the dialog counts it as the token copied)', async () => {
        const user = userEvent.setup();
        const onCopied = vi.fn();
        render(<ValheimModInstructions serverId="7" token="vl_secret_abc" onCopied={onCopied} />);
        await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
        await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });

    it('lists the restart, rotation, rebuild, catalogue and opt-out notes', () => {
        render(<ValheimModInstructions serverId="7" />);
        const notes = screen.getByTestId('valheim-link-token-instructions');
        expect(notes).toHaveTextContent('BepInEx/config/RaidLedger.ValheimLink.cfg');
        expect(notes).toHaveTextContent('within 10 minutes');
        expect(notes).toHaveTextContent('adminlist.txt');
        expect(notes).toHaveTextContent('OptOut = true');
    });

    it('links the full runbook in a new tab', () => {
        render(<ValheimModInstructions serverId="7" />);
        const link = screen.getByRole('link', { name: /runbook/i });
        expect(link).toHaveAttribute('href', RUNBOOK);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
});

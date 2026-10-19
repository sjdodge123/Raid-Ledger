/**
 * Mod-side setup notes for a Valheim Link token (ROK-1833): the `[RaidLedger]`
 * config block (copyable), what rotation / a rebuilt instance / the item
 * catalogue / opt-out mean for the mod, and the full runbook link.
 */
import type { JSX } from 'react';
import { CopyButton } from '../../../components/ui/CopyButton';
import { modConfigLines, VALHEIM_LINK_RUNBOOK_URL } from './valheim-link-token.helpers';

const PRE = 'whitespace-pre-wrap break-all font-mono text-xs text-secondary';
const CODE = 'font-mono text-xs';
const HIDDEN_TOKEN_LINE = 'ServerToken = (the token above — included when you copy)';

interface InstructionsProps {
    serverId: string;
    /** The raw token, only where the dialog already holds it. It is copied, never drawn in the block. */
    token?: string;
    /** Copying the config block counts as copying the token. */
    onCopied?: (() => void) | undefined;
}

/** The §4.7 neutral instruction callout — set-up steps carry no status hue. */
export function ValheimModInstructions({ serverId, token, onCopied }: InstructionsProps): JSX.Element {
    const origin = window.location.origin;
    const copied = modConfigLines(origin, serverId, token);
    const shown = token === undefined ? copied.config : [...copied.config.slice(0, -1), HIDDEN_TOKEN_LINE];
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 space-y-3" data-testid="valheim-link-token-instructions">
            <p className="text-sm font-medium text-foreground">Set up the mod</p>
            <div className="flex items-start justify-between gap-2">
                <pre className={PRE} data-testid="valheim-link-config-block">{shown.join('\n')}</pre>
                <CopyButton text={copied.config.join('\n')} onCopied={onCopied} />
            </div>
            <SetupSteps />
            <p className="text-sm font-medium text-foreground">The mod uploads to</p>
            <pre className={PRE}>{copied.endpoints.join('\n')}</pre>
        </div>
    );
}

function SetupSteps(): JSX.Element {
    return (
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-secondary">
            <li>Put these lines in the game server&apos;s <code className={CODE}>BepInEx/config/RaidLedger.ValheimLink.cfg</code> under <code className={CODE}>[RaidLedger]</code>, then restart the server.</li>
            <li>The token is shown once and the mod never logs it. Rotating it invalidates the old one at once: uploads stop with a 401 and resume on their own within 10 minutes after the new token is in the config (no restart).</li>
            <li>If this Raid Ledger instance is rebuilt or moved, the mod notices the new target at its next start and re-sends the world&apos;s base map and the item catalogue; players&apos; character and map data re-send on their next save.</li>
            <li>The item catalogue (names and icons) is exported by a player whose SteamID64 is in the game server&apos;s <code className={CODE}>adminlist.txt</code> (<code className={CODE}>Steam_7656…</code> format), once per game version — make sure one admin joins after a game update.</li>
            <li>Per-player opt-out: <code className={CODE}>[Client] OptOut = true</code> in the same config file on the player&apos;s PC.</li>
            <li>
                <a href={VALHEIM_LINK_RUNBOOK_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Full runbook</a>
                {' '}for everything else.
            </li>
        </ol>
    );
}

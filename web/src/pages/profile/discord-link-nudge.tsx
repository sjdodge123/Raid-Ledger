/**
 * ROK-2371: shown to a user who signs in with Google and has no Discord
 * linked — event DMs, hubs and Discord-button signups all need Discord.
 */
import type { JSX } from 'react';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { needsDiscordNudge } from './signin-methods.helpers';

export function DiscordLinkNudge({ methods }: { methods: SigninMethodsDto | undefined }): JSX.Element | null {
    if (!needsDiscordNudge(methods)) return null;
    return (
        <p className="mb-4 p-3 rounded-lg bg-overlay/30 border border-edge text-sm text-secondary"
            data-testid="discord-link-nudge">
            Link Discord to get event reminders by DM, join game hubs and sign up from Discord.
        </p>
    );
}

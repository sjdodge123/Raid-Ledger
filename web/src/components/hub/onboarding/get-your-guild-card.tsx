/**
 * ROK-1830 S5 (D11-B prompt 1) — "Get your guild on Raid Ledger", the Players
 * page card for a signed-in viewer who belongs to no hub.
 *
 * Core owns the frame and the dismissal; the game-specific how-to is handed in
 * as `how`, because only the module knows how a roster gets here (WoW: the
 * LedgerLink import). Dismissal is global (no `guildId`) — the viewer has no
 * hub to scope it to — and server-side, so it follows them to a second device.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../ui/button';
import { useHubOnboarding } from './use-hub-onboarding';

export function GetYourGuildCard({ how }: { how?: ReactNode }): JSX.Element | null {
    const prompt = useHubOnboarding('players-get-your-guild');
    if (!prompt.visible) return null;
    return (
        <section
            className="flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-start sm:justify-between"
            data-testid="get-your-guild-card"
            aria-labelledby="get-your-guild-title"
        >
            <div className="min-w-0">
                <h2 id="get-your-guild-title" className="text-lg font-semibold text-foreground">Get your guild on Raid Ledger</h2>
                <p className="mt-1 text-sm text-secondary">
                    A guild page gives your roster one place for the leader&apos;s post, the rules, your links and the next raid.
                </p>
                {how && <div className="mt-2 text-sm text-muted" data-testid="get-your-guild-how">{how}</div>}
                {prompt.failed && (
                    <p role="alert" data-testid="get-your-guild-error" className="mt-2 text-sm text-danger">
                        We couldn&apos;t dismiss that just now. Try again in a moment.
                    </p>
                )}
            </div>
            <div className="shrink-0">
                <Button variant="secondary" onClick={prompt.dismiss} data-testid="get-your-guild-dismiss">Dismiss</Button>
            </div>
        </section>
    );
}

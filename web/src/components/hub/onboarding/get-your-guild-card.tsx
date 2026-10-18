/**
 * ROK-1830 S5 (D11-B prompt 1) — "Get your guild on Raid Ledger", the Players
 * page card for a signed-in viewer who belongs to no hub.
 *
 * Core owns the frame and the dismissal; the game-specific how-to is handed in
 * as `how`, because only the module knows how a roster gets here (WoW: the
 * LedgerLink import). Dismissal is global (no `guildId`) — the viewer has no
 * hub to scope it to — and server-side, so it follows them to a second device.
 *
 * ROK-1840 restores the approved S0 prototype's shape: the how-to is folded
 * behind a primary "How to import" toggle, an icon-only × sits top-right, and
 * "Not now" is the secondary way out. Both × and "Not now" are the SAME
 * server-side dismissal the prototype wires them to (one `gyg-dismiss`
 * action) — there is no softer session-only hide in the approved target, so
 * both carry the prototype's one piece of wording, "Not now": two accessible
 * names implying different durations for one permanent action is a lie (r1).
 * The revealed panel is rendered AFTER the toggle and pointed at by
 * `aria-controls`, so forward navigation from the button lands on it.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Button } from '../../ui/button';
import { useHubOnboarding } from './use-hub-onboarding';

const CARD = 'flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4';
const HOW_PANEL_ID = 'get-your-guild-how-panel';

function CardHead({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 id="get-your-guild-title" className="text-lg font-semibold text-foreground">Get your guild on Raid Ledger</h2>
                <p className="mt-1 text-sm text-secondary">
                    A guild page gives your roster one place for the leader&apos;s post, the rules, your links and the next raid.
                </p>
            </div>
            <Button
                variant="ghost" size="sm" iconOnly aria-label="Not now"
                onClick={onClose} data-testid="get-your-guild-close"
            >
                <span aria-hidden>×</span>
            </Button>
        </div>
    );
}

export function GetYourGuildCard({ how }: { how?: ReactNode }): JSX.Element | null {
    const prompt = useHubOnboarding('players-get-your-guild');
    const [open, setOpen] = useState(false);
    if (!prompt.visible) return null;
    return (
        <section className={CARD} data-testid="get-your-guild-card" aria-labelledby="get-your-guild-title">
            <CardHead onClose={prompt.dismiss} />
            {prompt.failed && (
                <p role="alert" data-testid="get-your-guild-error" className="text-sm text-danger">
                    We couldn&apos;t dismiss that just now. Try again in a moment.
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                {how && (
                    <Button
                        variant="primary" onClick={() => { setOpen((v) => !v); }}
                        aria-expanded={open} aria-controls={HOW_PANEL_ID} data-testid="get-your-guild-how-toggle"
                    >
                        {open ? 'Hide steps' : 'How to import'}
                    </Button>
                )}
                <Button variant="secondary" onClick={prompt.dismiss} data-testid="get-your-guild-dismiss">Not now</Button>
            </div>
            {how && open && (
                <div id={HOW_PANEL_ID} className="text-sm text-muted" data-testid="get-your-guild-how">{how}</div>
            )}
            <p className="text-xs text-dim" data-testid="get-your-guild-note">
                Shown once, to signed-in players who are not in a guild yet.
            </p>
        </section>
    );
}

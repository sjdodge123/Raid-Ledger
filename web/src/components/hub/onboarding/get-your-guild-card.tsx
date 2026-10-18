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
 * a ghost "Not now" is the other way out, each flashing the prototype's
 * "Got it." toast once. Both × and "Not now" are the SAME
 * server-side dismissal the prototype wires them to (one `gyg-dismiss`
 * action) — there is no softer session-only hide in the approved target, so
 * the × carries the prototype's own label, "Dismiss: don't show this again", and the
 * ghost button reads "Not now": two accessible
 * names implying different durations for one permanent action is a lie (r1).
 * The revealed panel is rendered AFTER the toggle and pointed at by
 * `aria-controls`, so forward navigation from the button lands on it.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Button } from '../../ui/button';
import { toast } from '../../../lib/toast';
import { useHubOnboarding } from './use-hub-onboarding';

const CARD = 'flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4';
const HOW_PANEL_ID = 'get-your-guild-how-panel';
/** The prototype flashes this once per dismissal, from either way out. */
const DISMISS_TOAST = "Got it. We won't show this again.";

function CardHead({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 id="get-your-guild-title" className="text-lg font-semibold text-foreground">Get your guild on Raid Ledger</h2>
                <p className="mt-1 text-sm text-secondary">
                    Playing WoW with a guild? Export it from the game with the LedgerLink addon and import it
                    here. Your guildmates get a shared page for raids, attendance and the leader post.
                </p>
            </div>
            <Button
                variant="ghost" size="sm" iconOnly aria-label="Dismiss: don't show this again"
                onClick={onClose} data-testid="get-your-guild-close"
            >
                <span aria-hidden>×</span>
            </Button>
        </div>
    );
}

function CardActions(
    { hasHow, open, onToggle, onDismiss }: { hasHow: boolean; open: boolean; onToggle: () => void; onDismiss: () => void },
): JSX.Element {
    return (
        <div className="flex flex-wrap gap-2">
            {hasHow && (
                <Button
                    variant="primary" onClick={onToggle}
                    aria-expanded={open} aria-controls={HOW_PANEL_ID} data-testid="get-your-guild-how-toggle"
                >
                    {open ? 'Hide steps' : 'How to import'}
                </Button>
            )}
            <Button variant="ghost" onClick={onDismiss} data-testid="get-your-guild-dismiss">Not now</Button>
        </div>
    );
}

export function GetYourGuildCard({ how }: { how?: ReactNode }): JSX.Element | null {
    const prompt = useHubOnboarding('players-get-your-guild');
    const [open, setOpen] = useState(false);
    // One handler behind both ways out, so a dismissal toasts exactly once.
    // The toast is gated on the CONFIRMED write, not on the click: the hide is
    // optimistic, and a rejected dismissal rolls the card back — promising
    // "we won't show this again" over a card that is about to return is a lie
    // (Codex P2 r2). A failure says so in the alert line below instead.
    const dismiss = (): void => {
        prompt.dismiss({ onSuccess: () => { toast.success(DISMISS_TOAST); } });
    };
    if (!prompt.visible) return null;
    return (
        <section className={CARD} data-testid="get-your-guild-card" aria-labelledby="get-your-guild-title">
            <CardHead onClose={dismiss} />
            {prompt.failed && (
                <p role="alert" data-testid="get-your-guild-error" className="text-sm text-danger">
                    We couldn&apos;t dismiss that just now. Try again in a moment.
                </p>
            )}
            <CardActions hasHow={how !== undefined} open={open} onToggle={() => { setOpen((v) => !v); }} onDismiss={dismiss} />
            {how && open && (
                <div id={HOW_PANEL_ID} className="text-sm text-muted" data-testid="get-your-guild-how">{how}</div>
            )}
            <p className="text-xs text-dim" data-testid="get-your-guild-note">
                Shown once, to signed-in players who are not in a guild yet.
            </p>
        </section>
    );
}

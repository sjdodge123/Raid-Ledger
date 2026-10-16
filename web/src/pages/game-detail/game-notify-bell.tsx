/**
 * The per-game notification bell (ROK-1797), beside the heart on the game page.
 *
 * The bell OPENS a panel (Lead decision D6) — the `Switch` inside it toggles
 * the mute — so it carries `aria-haspopup="dialog"` + `aria-expanded`, not
 * `aria-pressed`. The icon still shows the state (D7). ≥1024px the panel is an
 * anchored popover, below it a `BottomSheet`. Rendered inside the page's
 * authenticated row, so it needs no auth guard of its own, and it shows
 * whether or not the game is hearted.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import { BellIcon, BellSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { usePortalTarget } from '../../components/ui/use-anchored-popup';
import { useMediaQuery } from '../../hooks/use-media-query';
import { useGameNotificationMute } from '../../hooks/use-game-notification-mute';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { GameNotifyPanelBody, GameNotifyPopover, type NotifyPanelState } from './game-notify-bell-panel';
import { useGameNotifyDeepLink } from './use-game-notify-deep-link';

export function GameNotifyBell({ gameId, gameName }: { gameId: number; gameName: string }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const openPanel = useCallback(() => setOpen(true), []);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const { anchorRef, setAnchorRef, container } = usePortalTarget();
    const { muted, isReady, isPending, setMuted } = useGameNotificationMute(gameId);
    useGameNotifyDeepLink(isReady, openPanel);

    const panel: NotifyPanelState = { gameName, muted, disabled: !isReady || isPending, onMutedChange: setMuted };
    const Icon = muted ? BellSlashIcon : BellIcon;
    return (
        <div ref={setAnchorRef} className="inline-flex">
            <Button ref={bellRef} variant="secondary" iconOnly data-testid="game-notify-bell"
                aria-label={`Notifications for ${gameName}: ${muted ? 'muted' : 'on'}`}
                aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                <Icon className="w-5 h-5" aria-hidden="true" />
            </Button>
            {isDesktop ? (
                <GameNotifyPopover open={open} onClose={close} anchorRef={anchorRef} bellRef={bellRef}
                    container={container} panel={panel} />
            ) : (
                <BottomSheet isOpen={open} onClose={close} title={`Notifications for ${gameName}`}>
                    <GameNotifyPanelBody {...panel} />
                </BottomSheet>
            )}
        </div>
    );
}

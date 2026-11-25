/**
 * Dismissible banner prompting users without Steam linked to connect
 * during the lineup building phase (ROK-993).
 *
 * ROK-2319: a neutral instruction callout (design-system §4.7) on tokens, so it
 * follows the app scheme — the old `dark:` variants followed the OS instead —
 * and the dismiss × is an inventory icon button with a 44px phone target.
 */
import { useState } from 'react';
import { Button } from '../ui/button';
import { useSteamLink } from '../../hooks/use-steam-link';
import { safeGetItem, safeSetItem } from '../../lib/safe-storage';

interface SteamNudgeBannerProps {
    lineupId: number;
    lineupStatus: string;
    userSteamId: string | null;
}

const STORAGE_KEY_PREFIX = 'raid_ledger_steam_nudge_dismissed_';

function isDismissed(lineupId: number): boolean {
    return safeGetItem(`${STORAGE_KEY_PREFIX}${lineupId}`) === 'true';
}

/** Banner action buttons — Link Steam CTA and dismiss. */
function BannerActions({ onDismiss }: { onDismiss: () => void }) {
    const { linkSteam, isLinkPending } = useSteamLink();
    return (
        <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" onClick={() => { void linkSteam(); }} disabled={isLinkPending}>
                Link Steam
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss" onClick={onDismiss}>
                <span aria-hidden className="text-lg leading-none">&times;</span>
            </Button>
        </div>
    );
}

export function SteamNudgeBanner({ lineupId, lineupStatus, userSteamId }: SteamNudgeBannerProps) {
    const [dismissed, setDismissed] = useState(() => isDismissed(lineupId));

    if (userSteamId || lineupStatus !== 'building' || dismissed) {
        return null;
    }

    const handleDismiss = () => {
        safeSetItem(`${STORAGE_KEY_PREFIX}${lineupId}`, 'true');
        setDismissed(true);
    };

    return (
        <div
            data-testid="steam-nudge-banner"
            className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-overlay/30 px-4 py-2 text-sm text-secondary"
        >
            <p>Connect your account to include your game library in suggestions.</p>
            <BannerActions onDismiss={handleDismiss} />
        </div>
    );
}

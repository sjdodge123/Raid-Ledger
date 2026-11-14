/**
 * ROK-1170 — the WoW hub's `heroBanner`: a persistent §4.7 `warning` status
 * banner under the hero once the Blizzard guild summary 404s for a slug that
 * used to resolve (`blizzardGuild.state === 'disbanded'`). Everyone sees the
 * copy; an editor (or the rank-0 GM, ROK-2192) who can open hub settings also
 * gets "Update the guild path", which opens the settings sheet scrolled to +
 * focused on the Blizzard roster section's slug field (ROK-2188; was the top
 * of the sheet, spec F7).
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { Button } from '../../../components/ui/button';
import { DialogBanner } from '../../../components/ui/dialog-banner';
import { useHubSettings } from '../../../components/hub/settings/hub-settings-context';
import { canWriteHubSettings } from '../../../components/hub/settings/settings-access';
import { BLIZZARD_ROSTER_SETTINGS_SECTION } from '../guild/blizzard-roster-section-id';

const COPY = 'Blizzard no longer finds this guild — it may have been disbanded or renamed in game';

/** The banner itself; `onUpdate` null = the member variant (copy only). */
export function GuildStateBannerView({ onUpdate }: { onUpdate: (() => void) | null }): JSX.Element {
    return (
        <DialogBanner tone="warning" role="status" testId="wow-guild-state-banner">
            <span>{COPY}</span>
            {onUpdate && <Button variant="warning-soft" size="sm" onClick={onUpdate}>Update the guild path</Button>}
        </DialogBanner>
    );
}

/** Renders only for a disbanded guild; the action needs `canEdit` (or rank 0, ROK-2192) and a settings entry. */
export function WowGuildStateBanner({ page }: HubCtx): JSX.Element | null {
    const { openSettings } = useHubSettings();
    if (page.guild.blizzardGuild?.state !== 'disbanded') return null;
    const onUpdate = canWriteHubSettings(page.viewer) && openSettings
        ? () => openSettings({ section: BLIZZARD_ROSTER_SETTINGS_SECTION })
        : null;
    return <GuildStateBannerView onUpdate={onUpdate} />;
}

/**
 * ROK-1830 S4 — "Guild settings" (D10-A): ONE sheet holding every switch the
 * hub's Leader owns, so content stays editable inline and the page keeps no
 * second settings surface. Shell is the inventory pair, not a new one
 * (design-system §4.4): `Modal` at ≥1024px, `BottomSheet` below — the same
 * split `GuildDiscordPicker` and `AddonImportDialog` already ship.
 *
 * The approved prototype draws a 440px panel anchored to the trigger; that is
 * a third shell nothing in the inventory has, so the Modal/BottomSheet pair is
 * used instead and the divergence is flagged in the PR rather than invented
 * around.
 */
import type { JSX } from 'react';
import type { GuildDiscordMirrorDto } from '@raid-ledger/contract';
import type { HubCtx, HubModule } from '../../../plugins/hub-module';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useGuildDiscord } from '../discord/use-guild-discord';
import { HubEditorsSection } from './settings-editors';
import { SettingsSection, SettingsSwitchRow } from './settings-rows';

/** Q7: `guilds.hidden_at` and its filtering land with the guild directory (ROK-1831). */
const HIDE_HUB_REASON = 'Hiding a hub isn’t available yet — it arrives with the guild directory.';

function channelLine(mirror: GuildDiscordMirrorDto | undefined): string {
    if (!mirror) return 'Loading…';
    if (mirror.state === 'ok') return `#${mirror.channel.name}`;
    if (mirror.state === 'unset') return 'No channel chosen yet.';
    const name = 'channelName' in mirror && mirror.channelName ? `#${mirror.channelName}` : null;
    return name ? `${name} — Raid Ledger can’t read it right now.` : 'The bound channel is unavailable.';
}

function DiscordSection({ guildId, onChangeChannel }: { guildId: number; onChangeChannel: () => void }): JSX.Element {
    const mirror = useGuildDiscord(guildId).data;
    const bound = mirror !== undefined && mirror.state !== 'unset';
    return (
        <SettingsSection title="Discord channel" testId="guild-settings-discord"
            blurb="The channel mirrored read-only on the Overview tab.">
            <p className="text-sm text-secondary" data-testid="guild-settings-channel">{channelLine(mirror)}</p>
            <div>
                <Button variant="secondary" size="sm" onClick={onChangeChannel} data-testid="guild-settings-choose-channel">
                    {bound ? 'Change channel' : 'Choose channel'}
                </Button>
            </div>
        </SettingsSection>
    );
}

export interface HubSettingsSheetProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    onClose: () => void;
    onChangeChannel: () => void;
}

function SheetBody({ ctx, module: mod, onChangeChannel }: Omit<HubSettingsSheetProps, 'onClose'>): JSX.Element {
    return (
        <div className="flex flex-col gap-5" data-testid="guild-settings-sheet">
            <DiscordSection guildId={ctx.page.guild.id} onChangeChannel={onChangeChannel} />
            <SettingsSection title="Page editors" blurb="Who can edit this guild’s page." testId="guild-settings-editors">
                <HubEditorsSection ctx={ctx} module={mod} />
            </SettingsSection>
            <SettingsSection title="Visibility" testId="guild-settings-visibility">
                <SettingsSwitchRow label="Hide this hub" hint={HIDE_HUB_REASON} checked={false} disabled
                    testId="guild-settings-hide-hub" />
            </SettingsSection>
        </div>
    );
}

export function HubSettingsSheet({ ctx, module: mod, onClose, onChangeChannel }: HubSettingsSheetProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = {
        isOpen: true,
        onClose,
        title: 'Guild settings',
        footer: <Button variant="secondary" onClick={onClose} data-testid="guild-settings-done">Done</Button>,
    };
    const body = <SheetBody ctx={ctx} module={mod} onChangeChannel={onChangeChannel} />;
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{body}</Modal>;
    return <BottomSheet {...shared} maxHeight="85vh">{body}</BottomSheet>;
}

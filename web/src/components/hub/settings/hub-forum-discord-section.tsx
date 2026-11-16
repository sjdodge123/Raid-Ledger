/**
 * ROK-2208 S3 — the hub settings sheet's "Discord forum" section (every hub
 * kind; spec §7 + the approved Q10 mockup). Officer+ reads the status (§6);
 * only `canManageDiscord` viewers (staff, or a community hub's Leader) get
 * the opt-in form and Unlink. Members never see the section (the sheet's
 * editor gate). Owned by Core's `hub-forum.discord-sync` behaviour.
 */
import type { JSX } from 'react';
import { SettingsSection } from './settings-rows';
import { HubForumDiscordBindForm } from './hub-forum-discord-bind-form';
import { HubForumDiscordBound } from './hub-forum-discord-bound';
import { useHubForumDiscord, useHubForumDiscordChannels } from './use-hub-forum-discord';

interface BodyProps { guildId: number; canManage: boolean }

function UnboundBody({ guildId, canManage }: BodyProps): JSX.Element {
    const channels = useHubForumDiscordChannels(guildId, canManage);
    if (!canManage) {
        return <p className="text-sm text-muted" data-testid="hub-forum-discord-off">Not linked. Server staff or the hub’s Leader can turn it on.</p>;
    }
    if (channels.isError) {
        return <p role="alert" className="text-sm text-danger" data-testid="hub-forum-discord-channels-error">{channels.error.message || 'Couldn’t list Discord forums. Try again later.'}</p>;
    }
    if (!channels.data) return <p className="text-sm text-secondary">Loading…</p>;
    return <HubForumDiscordBindForm guildId={guildId} channels={channels.data.channels} />;
}

function SectionBody({ guildId, canManage }: BodyProps): JSX.Element {
    const status = useHubForumDiscord(guildId);
    if (status.isError) {
        return <p role="alert" className="text-sm text-danger" data-testid="hub-forum-discord-error">Couldn’t load the Discord forum link. Try again later.</p>;
    }
    if (!status.data) return <p className="text-sm text-secondary" data-testid="hub-forum-discord-loading">Loading…</p>;
    const { binding } = status.data;
    if (binding) return <HubForumDiscordBound guildId={guildId} binding={binding} canManage={canManage} />;
    return <UnboundBody guildId={guildId} canManage={canManage} />;
}

export interface HubForumDiscordSectionProps {
    guildId: number;
    /** The api's `canManageDiscord` (`canBindForumDiscord`). */
    canManage: boolean;
}

/** The "Discord forum" section; the sheet mounts it for editors (Officer+). */
export function HubForumDiscordSection({ guildId, canManage }: HubForumDiscordSectionProps): JSX.Element {
    return (
        <SettingsSection title="Discord forum" testId="guild-settings-forum-discord"
            blurb="Sync this hub’s Forum with a Discord forum channel. New threads and replies show up on both sides from the moment you turn it on.">
            <SectionBody guildId={guildId} canManage={canManage} />
        </SettingsSection>
    );
}

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
import { useHubForumDiscord, useHubForumDiscordChannels, useHubForumDiscordPreflight } from './use-hub-forum-discord';

interface BodyProps { guildId: number; canManage: boolean; viewerIsLeader: boolean }

const LOADING = <p className="text-sm text-secondary" role="status" data-testid="hub-forum-discord-loading">Loading…</p>;

function alertLine(testId: string, text: string): JSX.Element {
    return <p role="alert" className="text-sm text-danger" data-testid={testId}>{text}</p>;
}

/** Who may turn it on, said to someone who can't (a non-community Leader can't either). */
function offCopy(viewerIsLeader: boolean): string {
    return viewerIsLeader ? 'Not linked. Ask server staff to turn it on.' : 'Not linked. Server staff or the hub’s Leader can turn it on.';
}

/** Preflight first (never 503s); the channel list only while the bot is online. */
function UnboundForm({ guildId }: { guildId: number }): JSX.Element {
    const preflight = useHubForumDiscordPreflight(guildId, true);
    const online = preflight.data?.botOnline === true;
    const channels = useHubForumDiscordChannels(guildId, online);
    if (preflight.isError) return alertLine('hub-forum-discord-channels-error', preflight.error.message || 'Couldn’t check the Discord bot. Try again later.');
    if (online && channels.isError) return alertLine('hub-forum-discord-channels-error', channels.error.message || 'Couldn’t list Discord forums. Try again later.');
    if (!preflight.data || (online && !channels.data)) return LOADING;
    return <HubForumDiscordBindForm guildId={guildId} preflight={preflight.data} channels={channels.data?.channels ?? []} />;
}

function UnboundBody({ guildId, canManage, viewerIsLeader }: BodyProps): JSX.Element {
    if (!canManage) return <p className="text-sm text-muted" data-testid="hub-forum-discord-off">{offCopy(viewerIsLeader)}</p>;
    return <UnboundForm guildId={guildId} />;
}

function SectionBody({ guildId, canManage, viewerIsLeader }: BodyProps): JSX.Element {
    const status = useHubForumDiscord(guildId);
    if (status.isError) {
        return <p role="alert" className="text-sm text-danger" data-testid="hub-forum-discord-error">Couldn’t load the Discord forum link. Try again later.</p>;
    }
    if (!status.data) return LOADING;
    const { binding } = status.data;
    if (binding) return <HubForumDiscordBound guildId={guildId} binding={binding} canManage={canManage} />;
    return <UnboundBody guildId={guildId} canManage={canManage} viewerIsLeader={viewerIsLeader} />;
}

export interface HubForumDiscordSectionProps {
    guildId: number;
    /** The api's `canManageDiscord` (`canBindForumDiscord`). */
    canManage: boolean;
    /** The viewer is this hub's Leader; picks the read-only copy (staff still decide for non-community hubs). */
    viewerIsLeader?: boolean;
}

/** The "Discord forum" section; the sheet mounts it for editors (Officer+). */
export function HubForumDiscordSection({ guildId, canManage, viewerIsLeader = false }: HubForumDiscordSectionProps): JSX.Element {
    return (
        <SettingsSection title="Discord forum" testId="guild-settings-forum-discord"
            blurb="Sync this hub’s Forum with a Discord forum channel. New threads and replies show up on both sides from the moment you turn it on.">
            <SectionBody guildId={guildId} canManage={canManage} viewerIsLeader={viewerIsLeader} />
        </SettingsSection>
    );
}

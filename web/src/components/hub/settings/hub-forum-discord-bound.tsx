/**
 * ROK-2208 S3 — the bound "Discord forum" state (approved Q10 mockup):
 * a "Syncing" `StatusChip`, the channel, the shared line, the cut-off date,
 * a §4.7 `DialogBanner` while the bot is degraded, and Unlink behind a
 * confirm (`Modal` ≥1024px, `BottomSheet` below). "Also delete the Discord
 * forum" is offered only for a bot-made, unshared forum (Q8). No Pause (Q7).
 */
import { useState, type JSX } from 'react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { DialogBanner } from '../../ui/dialog-banner';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { StatusChip } from '../../ui/status-chip';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import type { HubForumDiscordBinding } from './hub-forum-discord-api';
import { canDeleteForum, healthMessage, sharedLine } from './hub-forum-discord.helpers';
import { useUnlinkHubForumDiscord } from './use-hub-forum-discord';

interface ConfirmProps { guildId: number; binding: HubForumDiscordBinding; onClose: () => void }

function UnlinkConfirm({ guildId, binding, onClose }: ConfirmProps): JSX.Element {
    const Shell = useMediaQuery(DESKTOP_MQ) ? Modal : BottomSheet;
    const [alsoDelete, setAlsoDelete] = useState(false);
    const unlink = useUnlinkHubForumDiscord(guildId);
    const footer = (
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Keep syncing</Button>
            <Button variant="destructive" loading={unlink.isPending} data-testid="hub-forum-discord-unlink-confirm"
                onClick={() => unlink.mutate(alsoDelete, { onSuccess: onClose })}>Unlink</Button>
        </div>
    );
    return (
        <Shell isOpen onClose={onClose} title="Unlink the Discord forum?" footer={footer}>
            <div className="flex flex-col gap-3" data-testid="hub-forum-discord-unlink-dialog">
                <p className="text-sm text-secondary">Threads stay on both sides; new posts stop syncing.</p>
                {canDeleteForum(binding) ? (
                    <Checkbox label={`Also delete #${binding.channelName || 'the forum'} on Discord`} checked={alsoDelete}
                        data-testid="hub-forum-discord-also-delete" onChange={(e) => setAlsoDelete(e.target.checked)} />
                ) : binding.shared && <p className="text-sm text-muted">Other hubs share this forum, so it stays on Discord.</p>}
                {unlink.error && <p role="alert" className="text-sm text-danger">{unlink.error.message}</p>}
            </div>
        </Shell>
    );
}

function BindingLines({ binding }: { binding: HubForumDiscordBinding }): JSX.Element {
    const shared = sharedLine(binding);
    return (
        <div className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={binding.health === 'ok' ? 'success' : 'warning'} title="Discord forum sync">Syncing</StatusChip>
                <span className="font-medium text-foreground" data-testid="hub-forum-discord-channel-name">#{binding.channelName || binding.channelId}</span>
            </div>
            {shared && <p className="text-secondary" data-testid="hub-forum-discord-shared">{shared}</p>}
            <p className="text-xs text-muted">Since {new Date(binding.boundAt).toLocaleDateString()}. Posts from before then don’t sync.</p>
        </div>
    );
}

export interface HubForumDiscordBoundProps { guildId: number; binding: HubForumDiscordBinding; canManage: boolean }

/** The bound state; Unlink only for viewers who may manage the binding. */
export function HubForumDiscordBound({ guildId, binding, canManage }: HubForumDiscordBoundProps): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const health = healthMessage(binding);
    const offline = binding.health === 'bot-offline';
    return (
        <div className="flex flex-col gap-3" data-testid="hub-forum-discord-bound">
            <BindingLines binding={binding} />
            {health && (offline
                ? <p className="text-sm text-muted" data-testid="hub-forum-discord-health">{health}</p>
                : <DialogBanner tone="warning" role="status" spacing="" testId="hub-forum-discord-health">{health}</DialogBanner>)}
            {canManage && (
                <div>
                    <Button variant="destructive-soft" size="sm" disabled={offline} onClick={() => setConfirming(true)}
                        data-testid="hub-forum-discord-unlink">Unlink</Button>
                </div>
            )}
            {confirming && <UnlinkConfirm guildId={guildId} binding={binding} onClose={() => setConfirming(false)} />}
        </div>
    );
}

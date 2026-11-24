/**
 * The rows of the notification matrix on `/profile/notifications` (ROK-179, ROK-2290, ROK-2311):
 * a grouped `<section>` with its sub-heading, each row's switches, its caption and the "—" a row
 * shows in a column it never sends by. Exported so `/dev/design-system` mounts the real thing.
 */
import type { ReactNode } from 'react';
import type { Channel, NotificationType } from '../../hooks/use-notifications';
import { notificationRowCaption, type NotificationRowCaption } from './notification-row-caption';
import { ChannelIcon } from './notification-channel-icons';
import { rowChannels, type NotificationTypeGroup } from './notification-type-meta';

/** A matrix column: the channel and the label its header (and screen readers) use. */
export interface ChannelColumn {
    channel: Channel;
    label: string;
}

/** One row's switch states, keyed by channel; a missing value reads as off. */
export type RowPrefs = Partial<Record<Channel, boolean>> | undefined;

function ChannelToggle({ channel, active, label, onToggle }: {
    channel: Channel; active: boolean; label: string; onToggle: () => void;
}) {
    return (
        <div className="w-10 sm:w-12 flex justify-center">
            <button type="button" onClick={onToggle}
                className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all ${
                    active ? 'text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-muted hover:text-secondary hover:bg-panel'
                }`}
                aria-label={`${active ? 'Disable' : 'Enable'} ${label} ${channel} notifications`}>
                <ChannelIcon channel={channel} active={active} />
            </button>
        </div>
    );
}

/** ROK-2290: what the row's switches add up to — "Discord DM only" (success) or "Muted" (muted). */
function RowCaption({ caption }: { caption: NotificationRowCaption }) {
    if (!caption) return null;
    const tone = caption === 'Discord DM only' ? 'text-success' : 'text-muted';
    return <div className={`text-xs mt-0.5 ${tone}`} data-testid="notif-row-caption">{caption}</div>;
}

/** ROK-2311: a column this row's notice never uses (in-app-only / DM-only rows) shows a dash, not a switch. */
export function ChannelNotOffered({ column }: { column: ChannelColumn }) {
    return (
        <div className="w-10 sm:w-12 flex justify-center text-dim" data-testid={`notif-not-offered-${column.channel}`}>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not sent by {column.label}</span>
        </div>
    );
}

export function NotificationRow({ type, label, description, visibleChannels, prefs, onToggle }: {
    type: NotificationType; label: string; description: string;
    visibleChannels: readonly ChannelColumn[];
    prefs: RowPrefs;
    onToggle: (type: NotificationType, channel: Channel) => void;
}) {
    const offered = rowChannels(type, visibleChannels).map((c) => c.channel);
    return (
        <div id={`notif-${type}`} tabIndex={-1}
            className="flex items-center py-3 hover:bg-panel/50 rounded-lg transition-colors -mx-2 px-2 focus:outline-none focus:ring-2 focus:ring-success/80">
            <div className="flex-1 min-w-0 mr-3">
                <div className="text-sm font-medium text-foreground truncate">{label}</div>
                <div className="text-xs text-muted truncate">{description}</div>
                <RowCaption caption={notificationRowCaption(prefs, offered)} />
            </div>
            <div className="flex gap-2 sm:gap-4 shrink-0">
                {visibleChannels.map((column) => offered.includes(column.channel) ? (
                    <ChannelToggle key={column.channel} channel={column.channel} active={prefs?.[column.channel] ?? false}
                        label={label} onToggle={() => onToggle(type, column.channel)} />
                ) : <ChannelNotOffered key={column.channel} column={column} />)}
            </div>
        </div>
    );
}

/** Stable id for a group heading, e.g. "Games & groups" → `notif-group-games-groups`. */
function groupHeadingId(heading: string): string {
    return `notif-group-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

/** ROK-2311: one sub-heading of the matrix and its rows; `afterRow` mounts extras (muted lists) under a row. */
export function NotificationGroup({ group, visibleChannels, prefsOf, onToggle, afterRow }: {
    group: NotificationTypeGroup;
    visibleChannels: readonly ChannelColumn[];
    prefsOf: (type: NotificationType) => RowPrefs;
    onToggle: (type: NotificationType, channel: Channel) => void;
    afterRow?: (type: NotificationType) => ReactNode;
}) {
    const headingId = groupHeadingId(group.heading);
    return (
        <section aria-labelledby={headingId} data-testid="notif-group">
            <h3 id={headingId} className="text-[11px] font-semibold uppercase tracking-wider text-dim pt-3.5 pb-1">
                {group.heading}
            </h3>
            <div className="divide-y divide-edge-subtle border-t border-edge-subtle">
                {group.rows.map((meta) => (
                    <div key={meta.type}>
                        <NotificationRow {...meta} visibleChannels={visibleChannels} prefs={prefsOf(meta.type)} onToggle={onToggle} />
                        {afterRow?.(meta.type)}
                    </div>
                ))}
            </div>
        </section>
    );
}

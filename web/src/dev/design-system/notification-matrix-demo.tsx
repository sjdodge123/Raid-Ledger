/**
 * Notification-matrix sub-headings + the "—" not-offered cell for /dev/design-system
 * (docs/design-system.md, ROK-2311). Mounts the REAL `NotificationGroup` over one sample group:
 * a normal row, an in-app-only row (Push + Discord show "—") and a DM-only row (bell + Push "—").
 * Switches toggle local state only; nothing here calls the API. Tokens only, so it flips with the family.
 */
import { useState, type JSX } from 'react';
import type { Channel, NotificationType } from '../../hooks/use-notifications';
import { NotificationGroup, type ChannelColumn, type RowPrefs } from '../../components/profile/notification-matrix-rows';
import { NOTIFICATION_TYPE_META, type NotificationTypeGroup } from '../../components/profile/notification-type-meta';
import { StateFrame } from './design-system-bits';

const COLUMNS: readonly ChannelColumn[] = [
    { channel: 'inApp', label: 'In-App' },
    { channel: 'push', label: 'Push' },
    { channel: 'discord', label: 'Discord' },
];

const SAMPLE_TYPES: readonly NotificationType[] = ['scheduling_poll', 'lineup_lfg_offer', 'valheim_claim_suggestion'];

/** The three sample rows, picked from the shipped meta so the copy never drifts from `/profile/notifications`. */
const SAMPLE_GROUP: NotificationTypeGroup = {
    heading: 'Lineups & polls',
    rows: NOTIFICATION_TYPE_META.filter((meta) => SAMPLE_TYPES.includes(meta.type)),
};

const INITIAL: Partial<Record<NotificationType, RowPrefs>> = {
    scheduling_poll: { inApp: true, push: false, discord: true },
    lineup_lfg_offer: { inApp: true },
    valheim_claim_suggestion: { discord: true },
};

export function NotificationMatrixDemo(): JSX.Element {
    const [prefs, setPrefs] = useState(INITIAL);
    const toggle = (type: NotificationType, channel: Channel) =>
        setPrefs((prev) => ({ ...prev, [type]: { ...prev[type], [channel]: !(prev[type]?.[channel] ?? false) } }));
    return (
        <StateFrame label="Notification matrix — group heading + “—” not-offered cell"
            note="One sub-heading per group; a column the row never sends by shows “—” (sr-only “Not sent by <column>”).">
            <div className="w-full min-w-0" data-testid="ds-notification-matrix">
                <NotificationGroup group={SAMPLE_GROUP} visibleChannels={COLUMNS}
                    prefsOf={(type) => prefs[type]} onToggle={toggle} />
            </div>
        </StateFrame>
    );
}

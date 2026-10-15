/**
 * ROK-1740: the join post card's status banners (design-system §4.7) — a
 * `danger` banner when the bot lacks permissions in the picked channel
 * (nothing was posted), a `warning` banner when the post landed unpinned.
 */
import { Link } from 'react-router-dom';
import type { JoinPostPermissionName } from '@raid-ledger/contract';

const BOT_CONNECTION_PATH = '/admin/settings/discord/connection';

/** 422: nothing was posted — lists each permission the bot is missing. */
export function JoinPostMissingPermissions({ channelName, missing }: {
    channelName: string; missing: JoinPostPermissionName[];
}) {
    return (
        <div role="alert" data-testid="join-post-missing" className="bg-danger/10 border border-danger/30 rounded-lg p-4">
            <p className="text-sm text-danger">
                The bot can&apos;t post here. Missing in #{channelName}:
            </p>
            <ul className="text-xs text-danger mt-2 space-y-0.5 list-disc list-inside">
                {missing.map((name) => <li key={name}>{name}</li>)}
            </ul>
            <p className="text-xs text-danger mt-2">
                Grant them on the channel in Discord, or re-authorise the bot with the invite URL on the{' '}
                <Link to={BOT_CONNECTION_PATH} className="underline">Connection</Link> page.
            </p>
        </div>
    );
}

/** 200 with `pinned: false`: posted, but the server says why it isn't pinned. */
export function JoinPostPinWarning({ warning }: { warning: string }) {
    return (
        <div role="status" data-testid="join-post-pin-warning" className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">Posted, but not pinned. {warning}</p>
        </div>
    );
}

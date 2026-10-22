/**
 * ROK-1870 — one `/hubs` directory card (design-system §4.2): game, hub name
 * (link to the hub page), blurb, member count + Leader, and an inline Join
 * that never navigates.
 * ROK-1875: every hub kind gets a kind chip; server and guild hubs show View
 * (membership is presence/character-driven) instead of Join.
 * ROK-1883: the action and the staff-only Hidden chip are the shared
 * `hub-row-bits` the game page's Hubs card renders too.
 */
import { memberCountLabel } from '../components/layout/hub-nav/my-hubs-queries';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { HubKindChip } from '../components/layout/hub-nav/hub-kind-chip';
import { HubHiddenChip, HubViewerAction, type HubViewerActionProps } from '../components/hub/hub-row-bits';

export type HubCardProps = HubViewerActionProps;

/** A directory card; Join is a sibling of the name link, so clicking it stays on the page. */
export function HubDirectoryCard(props: HubCardProps): JSX.Element {
    const { hub } = props;
    return (
        <article className="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-4" data-testid="hub-directory-card">
            <div className="flex items-center gap-2">
                {hub.gameIconUrl
                    ? <img src={hub.gameIconUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                    : <div className="h-6 w-6 shrink-0 rounded bg-panel" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{hub.gameName}</span>
                <HubHiddenChip hub={hub} />
                <HubKindChip kind={hub.kind} />
            </div>
            <Link to={`/guilds/${hub.id}`} className="text-base font-semibold text-foreground hover:underline">{hub.name}</Link>
            {hub.blurb && <p className="line-clamp-2 text-sm text-secondary">{hub.blurb}</p>}
            <div className="mt-auto flex items-center gap-2 pt-1">
                <span className="flex-1 text-xs text-muted">
                    {memberCountLabel(hub.memberCount)}{hub.kind === 'game_community' && hub.leaderName ? ` · Led by ${hub.leaderName}` : ''}
                </span>
                <HubViewerAction {...props} />
            </div>
        </article>
    );
}

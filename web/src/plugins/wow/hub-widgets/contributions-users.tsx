/**
 * ROK-2148 — "Mailworthy users": members whose Mailworthy said hello in the
 * last 60 days, as wrapping name chips (first 12, then "Show all N" expands
 * in place). The chip's tooltip says when it was last seen.
 */
import { useState, type JSX } from 'react';
import type { GuildContributionsUser } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { Button } from '../../../components/ui/button';
import { syncedAgo } from '../../../lib/synced-ago';
import { ContributionsSection } from './contributions-section';
import { USERS_EMPTY, USERS_PREVIEW, formatCount } from './contributions.helpers';

function UserChip({ user }: { user: GuildContributionsUser }): JSX.Element {
    return (
        <li data-testid="contributions-user" title={`Last seen ${syncedAgo(user.lastSeenAt)}`}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-edge bg-panel py-0.5 pl-0.5 pr-2.5 text-xs hover:border-edge-strong">
            <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-full bg-overlay text-[11px] font-bold text-foreground">
                {user.characterName.charAt(0).toUpperCase()}
            </span>
            <CharacterLink name={user.characterName} characterId={user.characterId} className="text-secondary hover:text-foreground" />
        </li>
    );
}

export function ContributionsUsers({ users }: { users: readonly GuildContributionsUser[] }): JSX.Element {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? users : users.slice(0, USERS_PREVIEW);
    return (
        <ContributionsSection title="Mailworthy users" testId="contributions-users">
            {users.length === 0 ? (
                <p data-testid="contributions-users-empty" className="py-2 text-sm text-muted">{USERS_EMPTY}</p>
            ) : (
                <>
                    <p data-testid="contributions-users-count" className="mb-2 text-xs text-muted">
                        <b className="font-semibold tabular-nums text-foreground">{formatCount(users.length)}</b>{' '}
                        {users.length === 1 ? 'member runs' : 'members run'} Mailworthy
                    </p>
                    <ul className="flex flex-wrap gap-1.5">{shown.map((u) => <UserChip key={u.characterName} user={u} />)}</ul>
                    {!expanded && users.length > USERS_PREVIEW && (
                        <Button variant="ghost" size="sm" className="mt-2 min-h-11 sm:min-h-9" data-testid="contributions-users-show-all"
                            onClick={() => setExpanded(true)}>
                            Show all {users.length}
                        </Button>
                    )}
                </>
            )}
        </ContributionsSection>
    );
}

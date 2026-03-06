import type { JSX } from 'react';
import { UserLink } from '../../components/common/UserLink';
import { toAvatarUser } from '../../lib/avatar';
import { CharacterCardCompact } from '../../components/characters/character-card-compact';
import { PluginSlot } from '../../plugins';
import { toast } from '../../lib/toast';
import type { EventResponseDto, EventRosterDto } from '@raid-ledger/contract';
import { alphabetical } from './event-detail-helpers';

interface SignupItem {
    id: number;
    status: string;
    confirmationStatus: string;
    isAnonymous?: boolean;
    discordUsername?: string | null;
    user: {
        id: number;
        username: string;
        avatar: string | null;
        discordId?: string | null;
        customAvatarUrl?: string | null;
        characters?: Array<{ gameId: string | number; name?: string; avatarUrl: string | null }>;
    };
    character?: {
        id: string;
        name: string;
        avatarUrl: string | null;
        faction?: string | null;
        level?: number | null;
        race?: string | null;
        class: string | null;
        spec: string | null;
        role: string | null;
        itemLevel: number | null;
        isMain?: boolean;
    } | null;
}

interface EventDetailRosterProps {
    roster: EventRosterDto | undefined;
    event: EventResponseDto;
}

/** Render a single signup entry with UserLink and optional character card */
function SignupEntry({ signup, event, showBadge }: {
    signup: SignupItem;
    event: EventResponseDto;
    showBadge?: { text: string; className: string };
}): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                {signup.isAnonymous ? (
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                        <span>{signup.discordUsername ?? signup.user.username}</span>
                        <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
                    </span>
                ) : (
                    <UserLink
                        userId={signup.user.id}
                        username={signup.user.username}
                        user={toAvatarUser(signup.user)}
                        gameId={event.game?.id ?? undefined}
                        showAvatar
                        size="md"
                    />
                )}
                {showBadge && (
                    <span className={showBadge.className}>{showBadge.text}</span>
                )}
            </div>
            {signup.character && (
                <CharacterCardCompact
                    id={signup.character.id}
                    name={signup.character.name}
                    avatarUrl={signup.character.avatarUrl}
                    faction={signup.character.faction}
                    level={signup.character.level}
                    race={signup.character.race}
                    className={signup.character.class}
                    spec={signup.character.spec}
                    role={signup.character.role}
                    itemLevel={signup.character.itemLevel}
                />
            )}
        </div>
    );
}

/**
 * Roster attendee list grouped by status (confirmed, tentative, pending, departed).
 */
export function EventDetailRoster({ roster, event }: EventDetailRosterProps): JSX.Element {
    const activeSignups = roster?.signups.filter(
        (s) => s.status !== 'declined' && s.status !== 'departed',
    ) || [];
    const departedSignups = roster?.signups.filter(
        (s) => s.status === 'departed',
    ).sort(alphabetical) || [];

    const tentativeSignups = activeSignups.filter(
        (s) => s.status === 'tentative',
    ).sort(alphabetical);
    const nonTentative = activeSignups.filter(
        (s) => s.status !== 'tentative',
    );
    const pendingSignups = nonTentative.filter(
        (s) => s.confirmationStatus === 'pending' && !s.isAnonymous,
    ).sort(alphabetical);
    const confirmedSignups = nonTentative.filter(
        (s) => s.confirmationStatus !== 'pending' || s.isAnonymous,
    ).sort(alphabetical);

    return (
        <div className="event-detail-roster">
            <h2>Attendees ({roster?.count ?? 0})</h2>

            {confirmedSignups.length > 0 && (
                <div className="event-detail-roster__group">
                    <h3><span role="img" aria-hidden="true">&#10003;</span> Confirmed ({confirmedSignups.length})</h3>
                    <div className="space-y-2">
                        {confirmedSignups.map((s) => (
                            <div key={s.id}>
                                <div className="flex items-center gap-2">
                                    <UserLink
                                        userId={s.user.id}
                                        username={s.user.username}
                                        user={toAvatarUser(s.user)}
                                        gameId={event.game?.id ?? undefined}
                                        showAvatar
                                        size="md"
                                    />
                                    <PluginSlot
                                        name="event-detail:signup-warnings"
                                        context={{
                                            characterLevel: s.character?.level,
                                            contentInstances: event.contentInstances ?? [],
                                            gameSlug: event.game?.slug,
                                        }}
                                    />
                                </div>
                                {s.character && (
                                    <CharacterCardCompact
                                        id={s.character.id}
                                        name={s.character.name}
                                        avatarUrl={s.character.avatarUrl}
                                        faction={s.character.faction}
                                        level={s.character.level}
                                        race={s.character.race}
                                        className={s.character.class}
                                        spec={s.character.spec}
                                        role={s.character.role}
                                        itemLevel={s.character.itemLevel}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tentativeSignups.length > 0 && (
                <div className="event-detail-roster__group">
                    <h3><span role="img" aria-hidden="true">&#8987;</span> Tentative ({tentativeSignups.length})</h3>
                    <div className="space-y-2">
                        {tentativeSignups.map((s) => (
                            <SignupEntry
                                key={s.id}
                                signup={s}
                                event={event}
                                showBadge={{ text: 'tentative', className: 'text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {pendingSignups.length > 0 && (
                <div className="event-detail-roster__group">
                    <h3><span role="img" aria-hidden="true">&#8987;</span> Pending ({pendingSignups.length})</h3>
                    <div className="event-detail-roster__list">
                        {pendingSignups.map((s) => (
                            <div key={s.id} className="event-detail-roster__item event-detail-roster__item--pending flex items-center gap-2">
                                {s.isAnonymous ? (
                                    <span className="flex items-center gap-1.5 text-sm text-muted">
                                        <span>{s.discordUsername ?? s.user.username}</span>
                                        <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
                                    </span>
                                ) : (
                                    <UserLink
                                        userId={s.user.id}
                                        username={s.user.username}
                                        user={toAvatarUser(s.user)}
                                        gameId={event.game?.id ?? undefined}
                                        showAvatar
                                        size="md"
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {departedSignups.length > 0 && (
                <div className="event-detail-roster__group">
                    <h3><span role="img" aria-hidden="true">&#128682;</span> Departed ({departedSignups.length})</h3>
                    <div className="event-detail-roster__list">
                        {departedSignups.map((s) => (
                            <div key={s.id} className="event-detail-roster__item flex items-center gap-2 opacity-50">
                                {s.isAnonymous ? (
                                    <span className="flex items-center gap-1.5 text-sm text-muted">
                                        <span>{s.discordUsername ?? s.user.username}</span>
                                        <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
                                    </span>
                                ) : (
                                    <UserLink
                                        userId={s.user.id}
                                        username={s.user.username}
                                        user={toAvatarUser(s.user)}
                                        gameId={event.game?.id ?? undefined}
                                        showAvatar
                                        size="md"
                                    />
                                )}
                                <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">departed</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {roster?.signups.length === 0 && (
                <div className="event-detail-roster__empty">
                    <p>No players signed up yet — share the event!</p>
                    <button
                        onClick={() => {
                            const url = window.location.href;
                            navigator.clipboard.writeText(url).then(() => {
                                toast.success('Event link copied to clipboard!');
                            });
                        }}
                        className="btn btn-secondary btn-sm mt-2"
                    >
                        Copy Event Link
                    </button>
                </div>
            )}
        </div>
    );
}

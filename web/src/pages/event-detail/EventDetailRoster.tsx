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

function AnonymousUserLabel({ signup }: { signup: SignupItem }) {
    return (
        <span className="flex items-center gap-1.5 text-sm text-muted">
            <span>{signup.discordUsername ?? signup.user.username}</span>
            <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
        </span>
    );
}

/** Render a single signup entry with UserLink and optional character card */
function SignupEntry({ signup, event, showBadge }: {
    signup: SignupItem; event: EventResponseDto; showBadge?: { text: string; className: string };
}): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                {signup.isAnonymous
                    ? <AnonymousUserLabel signup={signup} />
                    : <UserLink userId={signup.user.id} username={signup.user.username} user={toAvatarUser(signup.user)} gameId={event.game?.id ?? undefined} showAvatar size="md" />}
                {showBadge && <span className={showBadge.className}>{showBadge.text}</span>}
            </div>
            {signup.character && (
                <CharacterCardCompact id={signup.character.id} name={signup.character.name} avatarUrl={signup.character.avatarUrl}
                    faction={signup.character.faction} level={signup.character.level} race={signup.character.race}
                    className={signup.character.class} spec={signup.character.spec} role={signup.character.role} itemLevel={signup.character.itemLevel} />
            )}
        </div>
    );
}

/**
 * Roster attendee list grouped by status (confirmed, tentative, pending, departed).
 */
function categorizeSignups(roster: EventRosterDto | undefined) {
    const active = roster?.signups.filter((s) => s.status !== 'declined' && s.status !== 'departed') || [];
    const departed = roster?.signups.filter((s) => s.status === 'departed').sort(alphabetical) || [];
    const tentative = active.filter((s) => s.status === 'tentative').sort(alphabetical);
    const nonTentative = active.filter((s) => s.status !== 'tentative');
    const pending = nonTentative.filter((s) => s.confirmationStatus === 'pending' && !s.isAnonymous).sort(alphabetical);
    const confirmed = nonTentative.filter((s) => s.confirmationStatus !== 'pending' || s.isAnonymous).sort(alphabetical);
    return { confirmed, tentative, pending, departed };
}

export function EventDetailRoster({ roster, event }: EventDetailRosterProps): JSX.Element {
    const { confirmed, tentative, pending, departed } = categorizeSignups(roster);

    return (
        <div className="event-detail-roster">
            <h2>Attendees ({roster?.count ?? 0})</h2>
            <ConfirmedGroup signups={confirmed} event={event} />
            <TentativeGroup signups={tentative} event={event} />
            <SimpleSignupGroup signups={pending} event={event} title="Pending" icon="&#8987;" itemClass="event-detail-roster__item--pending" />
            <SimpleSignupGroup signups={departed} event={event} title="Departed" icon="&#128682;" itemClass="opacity-50" badge={{ text: 'departed', className: 'text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded' }} />
            {roster?.signups.length === 0 && <RosterEmptyState />}
        </div>
    );
}

function ConfirmedGroup({ signups, event }: { signups: SignupItem[]; event: EventResponseDto }) {
    if (signups.length === 0) return null;
    return (
        <div className="event-detail-roster__group">
            <h3><span role="img" aria-hidden="true">&#10003;</span> Confirmed ({signups.length})</h3>
            <div className="space-y-2">
                {signups.map((s) => (
                    <div key={s.id}>
                        <div className="flex items-center gap-2">
                            <UserLink userId={s.user.id} username={s.user.username} user={toAvatarUser(s.user)} gameId={event.game?.id ?? undefined} showAvatar size="md" />
                            <PluginSlot name="event-detail:signup-warnings" context={{ characterLevel: s.character?.level, contentInstances: event.contentInstances ?? [], gameSlug: event.game?.slug }} />
                        </div>
                        {s.character && (
                            <CharacterCardCompact id={s.character.id} name={s.character.name} avatarUrl={s.character.avatarUrl}
                                faction={s.character.faction} level={s.character.level} race={s.character.race}
                                className={s.character.class} spec={s.character.spec} role={s.character.role} itemLevel={s.character.itemLevel} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function TentativeGroup({ signups, event }: { signups: SignupItem[]; event: EventResponseDto }) {
    if (signups.length === 0) return null;
    return (
        <div className="event-detail-roster__group">
            <h3><span role="img" aria-hidden="true">&#8987;</span> Tentative ({signups.length})</h3>
            <div className="space-y-2">
                {signups.map((s) => <SignupEntry key={s.id} signup={s} event={event} showBadge={{ text: 'tentative', className: 'text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded' }} />)}
            </div>
        </div>
    );
}

function SimpleSignupGroup({ signups, event, title, icon, itemClass, badge }: {
    signups: SignupItem[]; event: EventResponseDto; title: string; icon: string; itemClass?: string;
    badge?: { text: string; className: string };
}) {
    if (signups.length === 0) return null;
    return (
        <div className="event-detail-roster__group">
            <h3><span role="img" aria-hidden="true">{icon}</span> {title} ({signups.length})</h3>
            <div className="event-detail-roster__list">
                {signups.map((s) => (
                    <div key={s.id} className={`event-detail-roster__item flex items-center gap-2 ${itemClass ?? ''}`}>
                        {s.isAnonymous ? <AnonymousUserLabel signup={s} /> : <UserLink userId={s.user.id} username={s.user.username} user={toAvatarUser(s.user)} gameId={event.game?.id ?? undefined} showAvatar size="md" />}
                        {badge && <span className={badge.className}>{badge.text}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}

function RosterEmptyState() {
    return (
        <div className="event-detail-roster__empty">
            <p>No players signed up yet — share the event!</p>
            <button onClick={() => navigator.clipboard.writeText(window.location.href).then(() => toast.success('Event link copied to clipboard!'))}
                className="btn btn-secondary btn-sm mt-2">Copy Event Link</button>
        </div>
    );
}

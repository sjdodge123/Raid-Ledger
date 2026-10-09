import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { UserLink } from '../../components/common/UserLink';
import { AnonymousDiscordName } from '../../components/common/AnonymousDiscordName';
import { toAvatarUser } from '../../lib/avatar';
import { guestProfileLink } from '../../lib/guest-profile-link';
import { CharacterCardCompact } from '../../components/characters/character-card-compact';
import { RoleIcon } from '../../components/shared/RoleIcon';
import { PluginSlot } from '../../plugins';
import { copyWithToast } from '../../lib/clipboard';
import type { EventResponseDto, SignupCharacterDto } from '@raid-ledger/contract';
import type { ViewerEventRosterDto } from '../../lib/api/viewer-event-schemas';
import { alphabetical } from './event-detail-helpers';

interface SignupItem {
    id: number;
    status: string;
    confirmationStatus: string;
    isAnonymous?: boolean | undefined;
    /** Anonymous Discord signups (ROK-137): the API fills these, and sends user.avatar as null */
    discordUserId?: string | null | undefined;
    discordUsername?: string | null | undefined;
    discordAvatarHash?: string | null | undefined;
    /** ROK-847: Preferred roles the player is willing to play */
    preferredRoles?: string[] | null | undefined;
    user: {
        id: number;
        username: string;
        avatar: string | null;
        discordId?: string | null | undefined;
        customAvatarUrl?: string | null | undefined;
        characters?: Array<{ gameId: string | number; name?: string | undefined; avatarUrl: string | null }> | undefined;
    };
    character?: SignupCharacterDto | null | undefined;
    /** ROK-1379 follow-up: running-late marker (⏰ badge parity with the Discord embed) */
    runningLate?: boolean | undefined;
    lateMinutes?: number | null | undefined;
}

interface EventDetailRosterProps {
    roster: ViewerEventRosterDto | undefined;
    event: EventResponseDto;
}

/** Inline role preference icons for a signup (ROK-847). */
function RolePreferenceBadges({ roles }: { roles?: string[] | null | undefined }) {
    if (!roles || roles.length === 0) return null;
    return (
        <span className="flex shrink-0 items-center gap-0.5">
            {roles.map((r, i) => (
                <RoleIcon key={`${r}-${i}`} role={r} size="w-4 h-4" />
            ))}
        </span>
    );
}

/** Running-late pill — web parity with the Discord embed's ⏰ roster marker (ROK-1379 follow-up). */
function RunningLateBadge({ signup }: { signup: Pick<SignupItem, 'runningLate' | 'lateMinutes'> }) {
    if (!signup.runningLate) return null;
    const minutes = signup.lateMinutes ?? null;
    return (
        <span
            className="shrink-0 text-xs text-warning bg-warning/10 px-1.5 py-0.5 rounded"
            title={minutes ? `Running late (+${minutes} min)` : 'Running late'}
        >
            <span role="img" aria-hidden="true">&#9200;</span> late{minutes ? ` +${minutes}m` : ''}
        </span>
    );
}

/**
 * Anonymous Discord signup → the ROK-381 guest profile, the same link its roster slot card uses (ROK-1694).
 * The API hardcodes `user.avatar: null` for these; the real hash is `discordAvatarHash` (the slot's `player.avatar`).
 */
function AnonymousUserLabel({ signup }: { signup: SignupItem }) {
    const name = signup.discordUsername ?? signup.user.username;
    const { to, state } = guestProfileLink({
        username: name,
        discordId: signup.discordUserId ?? signup.user.discordId ?? null,
        avatarHash: signup.discordAvatarHash ?? signup.user.avatar,
    });
    return (
        <Link to={to} state={state} className="group inline-flex min-w-0 rounded">
            <AnonymousDiscordName name={name} className="flex items-center gap-1.5 text-sm text-muted group-hover:text-foreground transition-colors" />
        </Link>
    );
}

/** An anonymous Discord signup has no member row (API sends user.id 0) — it links to the guest profile, not a member one. */
function isAnonymousSignup(signup: SignupItem): boolean {
    return Boolean(signup.isAnonymous) || !signup.user.id;
}

/** Member → profile UserLink; anonymous Discord signup → name + "via Discord" chip (ROK-1694). */
function SignupIdentity({ signup, event }: { signup: SignupItem; event: EventResponseDto }) {
    if (isAnonymousSignup(signup)) return <AnonymousUserLabel signup={signup} />;
    return <UserLink userId={signup.user.id} username={signup.user.username} user={toAvatarUser(signup.user)} gameId={event.game?.id ?? undefined} showAvatar size="md" />;
}

/** Render a single signup entry with UserLink and optional character card */
function SignupEntry({ signup, event, showBadge }: {
    signup: SignupItem; event: EventResponseDto; showBadge?: { text: string; className: string };
}): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <SignupIdentity signup={signup} event={event} />
                <RolePreferenceBadges roles={signup.preferredRoles} />
                {showBadge && <span className={showBadge.className}>{showBadge.text}</span>}
                <RunningLateBadge signup={signup} />
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
function categorizeSignups(roster: ViewerEventRosterDto | undefined) {
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
            {/* Departed rows are de-emphasised with muted text, not a whole-row opacity: opacity-50 halved the badge to ~2.2:1 (TDB:1770). */}
            <SimpleSignupGroup signups={departed} event={event} title="Departed" icon="&#128682;" itemClass="text-muted" badge={{ text: 'departed', className: 'text-xs text-danger bg-danger/10 px-1.5 py-0.5 rounded' }} />
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
                            <SignupIdentity signup={s} event={event} />
                            <RolePreferenceBadges roles={s.preferredRoles} />
                            <RunningLateBadge signup={s} />
                            <PluginSlot name="event-detail:signup-warnings" context={{ characterLevel: s.character?.level, contentInstances: event.contentInstances ?? [], gameSlug: event.game?.slug }} />
                        </div>
                        {s.character && (
                            <CharacterCardCompact id={s.character.id} name={s.character.name} avatarUrl={s.character.avatarUrl}
                                faction={s.character.faction} level={s.character.level} race={s.character.race}
                                className={s.character.class} spec={s.character.spec} role={s.character.role} itemLevel={s.character.itemLevel}
                                professions={s.character.professions} />
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
                {signups.map((s) => <SignupEntry key={s.id} signup={s} event={event} showBadge={{ text: 'tentative', className: 'text-xs text-warning bg-warning/10 px-1.5 py-0.5 rounded' }} />)}
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
                        <SignupIdentity signup={s} event={event} />
                        {badge && <span className={badge.className}>{badge.text}</span>}
                        <RunningLateBadge signup={s} />
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
            <button onClick={() => void copyWithToast(window.location.href, { success: 'Event link copied to clipboard!', error: 'Failed to copy link' })}
                className="btn btn-secondary btn-sm mt-2">Copy Event Link</button>
        </div>
    );
}

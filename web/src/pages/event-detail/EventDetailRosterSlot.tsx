/**
 * Roster slot section components for Event Detail page.
 * Extracted from event-detail-page.tsx for file size compliance (ROK-719).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { EventResponseDto, EventRosterDto, RosterWithAssignments } from '@raid-ledger/contract';
import { RosterBuilder } from '../../components/roster';
import { GameTimeWidget } from '../../components/features/game-time/GameTimeWidget';
import { AutoSubToggle, SignedUpActions } from './EventDetailSubComponents';
import type { useEventDetailHandlers } from './use-event-detail-handlers';

function RosterSlotHeader({ event, canManageRoster, canJoinSlot, isMMOGame, isAuthenticated, isSignedUp, userSignup, handlers }: {
    event: EventResponseDto; canManageRoster: boolean; canJoinSlot: boolean; isMMOGame: boolean;
    isAuthenticated: boolean; isSignedUp: boolean; userSignup: { status: string } | undefined; handlers: ReturnType<typeof useEventDetailHandlers>;
}) {
    return (
        <div className="event-detail-slots__header">
            <h2>
                Roster Slots
                {canManageRoster && <span className="badge badge--indigo hidden md:inline-flex">Click slot to assign</span>}
                {canJoinSlot && <span className="badge badge--green hidden md:inline-flex">Click to Join</span>}
            </h2>
            <div className="flex items-center gap-2">
                {canManageRoster && !isMMOGame && <AutoSubToggle event={event} handlers={handlers} />}
                {!isAuthenticated && <Link to="/login" className="btn btn-primary btn-sm">Login to Join</Link>}
                {canJoinSlot && <button onClick={handlers.handleSignup} disabled={handlers.signup.isPending} className="btn btn-primary btn-sm">{handlers.signup.isPending ? 'Joining...' : 'Join Event'}</button>}
                {isSignedUp && <SignedUpActions userSignup={userSignup} handlers={handlers} />}
            </div>
        </div>
    );
}

function buildStickyExtra(isAuthenticated: boolean, event: EventResponseDto, roster: EventRosterDto | undefined) {
    if (!isAuthenticated || !event.startTime || !event.endTime) return undefined;
    return (
        <GameTimeWidget eventStartTime={event.startTime} eventEndTime={event.endTime} eventTitle={event.title}
            gameName={event.game?.name} gameSlug={event.game?.slug} coverUrl={event.game?.coverUrl} description={event.description}
            creatorUsername={event.creator?.username}
            attendees={roster?.signups.slice(0, 6).map(s => ({ id: s.id, username: s.user.username, avatar: s.user.avatar ?? null }))}
            attendeeCount={roster?.count} />
    );
}

/** Roster slot section with RosterBuilder */
export function RosterSlotSection({ event, eventId, roster, rosterAssignments, isAuthenticated, isSignedUp, userSignup, canManageRoster, canJoinSlot, isMMOGame, handlers, user }: {
    event: EventResponseDto; eventId: number; roster: EventRosterDto | undefined; rosterAssignments: RosterWithAssignments | undefined;
    isAuthenticated: boolean; isSignedUp: boolean; userSignup: { status: string } | undefined;
    canManageRoster: boolean; canJoinSlot: boolean; isMMOGame: boolean; handlers: ReturnType<typeof useEventDetailHandlers>; user: { id: number } | null | undefined;
}): JSX.Element | null {
    if (!rosterAssignments) return null;
    return (
        <div className="event-detail-slots" id="event-roster-section">
            <RosterSlotHeader event={event} canManageRoster={canManageRoster} canJoinSlot={canJoinSlot} isMMOGame={isMMOGame}
                isAuthenticated={isAuthenticated} isSignedUp={isSignedUp} userSignup={userSignup} handlers={handlers} />
            <RosterBuilder pool={rosterAssignments.pool as never} assignments={rosterAssignments.assignments as never} slots={rosterAssignments.slots as never}
                onRosterChange={handlers.handleRosterChange as never} canEdit={canManageRoster} onSlotClick={handlers.handleSlotClick} canJoin={canJoinSlot}
                signupSucceeded={handlers.signup.isSuccess} currentUserId={user?.id}
                onSelfRemove={isSignedUp && !canManageRoster ? handlers.handleSelfRemove : undefined}
                onGenerateInviteLink={canManageRoster ? handlers.handleGenerateInviteLink : undefined}
                pugs={handlers.pugs} onRemovePug={canManageRoster ? handlers.handleRemovePug : undefined}
                onRegeneratePugLink={canManageRoster ? handlers.handleRegeneratePugLink : undefined} eventId={eventId}
                onRemoveFromEvent={canManageRoster ? handlers.handleRemoveFromEvent : undefined}
                gameId={event.game?.id} isMMOEvent={isMMOGame} stickyExtra={buildStickyExtra(isAuthenticated, event, roster)} />
        </div>
    );
}

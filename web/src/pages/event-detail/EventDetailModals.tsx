import type { JSX } from 'react';
import { lazy, Suspense } from 'react';
import { Modal } from '../../components/ui/modal';
import type { CharacterRole, PugSlotResponseDto, EventRosterDto, SeriesScope } from '@raid-ledger/contract';

// ROK-343: Lazy load modals
const SignupConfirmationModal = lazy(() =>
    import('../../components/events/signup-confirmation-modal').then(m => ({ default: m.SignupConfirmationModal })),
);
const RescheduleModal = lazy(() =>
    import('../../components/events/RescheduleModal').then(m => ({ default: m.RescheduleModal })),
);
const CancelEventModal = lazy(() =>
    import('../../components/events/cancel-event-modal').then(m => ({ default: m.CancelEventModal })),
);
const InviteModal = lazy(() =>
    import('../../components/events/invite-modal').then(m => ({ default: m.InviteModal })),
);
const SeriesScopeModal = lazy(() =>
    import('../../components/events/series-scope-modal').then(m => ({ default: m.SeriesScopeModal })),
);

interface ConfirmModalProps {
    show: boolean;
    onClose: () => void;
    onConfirm: (selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }) => void;
    onSkip: (opts?: { preferredRoles?: CharacterRole[] }) => void;
    isConfirming: boolean;
    gameId: number | undefined;
    gameName: string | undefined;
    hasRoles: boolean;
    gameSlug: string | undefined;
    preSelectedRole: CharacterRole | undefined;
    eventId: number;
}

/** Pre-signup selection modal wrapper */
export function ConfirmModalSection(props: ConfirmModalProps): JSX.Element | null {
    if (!props.show) return null;
    return (
        <Suspense fallback={null}>
            <SignupConfirmationModal
                isOpen={props.show}
                onClose={props.onClose}
                onConfirm={props.onConfirm}
                onSkip={props.onSkip}
                isConfirming={props.isConfirming}
                gameId={props.gameId}
                gameName={props.gameName}
                hasRoles={props.hasRoles}
                gameSlug={props.gameSlug}
                preSelectedRole={props.preSelectedRole}
                eventId={props.eventId}
            />
        </Suspense>
    );
}

interface CancelModalProps {
    show: boolean;
    onClose: () => void;
    eventId: number;
    eventTitle: string;
    signupCount: number;
    initialReason?: string;
}

/** Cancel event modal wrapper */
export function CancelModalSection(props: CancelModalProps): JSX.Element | null {
    if (!props.show) return null;
    return (
        <Suspense fallback={null}>
            <CancelEventModal
                isOpen={props.show}
                onClose={props.onClose}
                eventId={props.eventId}
                eventTitle={props.eventTitle}
                signupCount={props.signupCount}
                initialReason={props.initialReason}
            />
        </Suspense>
    );
}

interface RescheduleModalProps {
    show: boolean;
    onClose: () => void;
    eventId: number;
    currentStartTime: string;
    currentEndTime: string;
    eventTitle: string;
    gameSlug?: string;
    gameName?: string;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string;
    signupCount: number;
    initialReason?: string;
}

/** Reschedule event modal wrapper */
export function RescheduleModalSection(props: RescheduleModalProps): JSX.Element | null {
    if (!props.show) return null;
    return (
        <Suspense fallback={null}>
            <RescheduleModal
                isOpen={props.show}
                onClose={props.onClose}
                eventId={props.eventId}
                currentStartTime={props.currentStartTime}
                currentEndTime={props.currentEndTime}
                eventTitle={props.eventTitle}
                gameSlug={props.gameSlug}
                gameName={props.gameName}
                coverUrl={props.coverUrl}
                description={props.description}
                creatorUsername={props.creatorUsername}
                signupCount={props.signupCount}
                initialReason={props.initialReason}
            />
        </Suspense>
    );
}

interface InviteModalProps {
    show: boolean;
    onClose: () => void;
    eventId: number;
    pugs: PugSlotResponseDto[];
    roster: EventRosterDto | undefined;
    isMMOGame: boolean;
}

/** Invite modal wrapper */
export function InviteModalSection(props: InviteModalProps): JSX.Element | null {
    if (!props.show) return null;
    return (
        <Suspense fallback={null}>
            <InviteModal
                isOpen={props.show}
                onClose={props.onClose}
                eventId={props.eventId}
                existingPugUsernames={new Set(
                    props.pugs.filter(p => p.discordUsername).map(p => p.discordUsername!.toLowerCase()),
                )}
                signedUpDiscordIds={new Set(
                    (props.roster?.signups ?? [])
                        .map(s => s.user.discordId)
                        .filter((id): id is string => !!id),
                )}
                isMMOGame={props.isMMOGame}
            />
        </Suspense>
    );
}

interface RemoveConfirmModalProps {
    removeConfirm: { signupId: number; username: string } | null;
    onClose: () => void;
    onConfirm: () => void;
    isPending: boolean;
}

/** Remove user from event confirmation modal */
export function RemoveConfirmModal(props: RemoveConfirmModalProps): JSX.Element {
    return (
        <Modal isOpen={props.removeConfirm !== null} onClose={props.onClose} title="Remove from Event">
            {props.removeConfirm && (
                <div className="space-y-4">
                    <p className="text-sm text-secondary">
                        Remove <strong className="text-foreground">{props.removeConfirm.username}</strong> from this event? This will delete their signup and roster assignment.
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={props.onClose}>Cancel</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={props.onConfirm} disabled={props.isPending}>
                            {props.isPending ? 'Removing...' : 'Remove'}
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}

interface SeriesScopeModalProps {
    show: boolean;
    action: 'edit' | 'delete' | 'cancel';
    eventId: number;
    onClose: () => void;
    onSeriesConfirm: (action: 'edit' | 'delete' | 'cancel', scope: SeriesScope) => void;
    isPending?: boolean;
}

/** Series scope selection modal wrapper (ROK-429). */
export function SeriesScopeModalSection(props: SeriesScopeModalProps): JSX.Element | null {
    if (!props.show) return null;
    return (
        <Suspense fallback={null}>
            <SeriesScopeModal
                isOpen={props.show}
                onClose={props.onClose}
                onConfirm={(scope) => props.onSeriesConfirm(props.action, scope)}
                action={props.action}
                isPending={props.isPending}
            />
        </Suspense>
    );
}

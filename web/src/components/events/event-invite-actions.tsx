/**
 * EventInviteActions — Reusable Accept/Decline buttons for event invitations (ROK-292).
 *
 * Mirrors the Discord embed flow:
 *   Accept → sign up → character confirmation modal → done
 *   Decline → dismiss notification
 *
 * Used by NotificationItem for invite notifications. Can be embedded anywhere
 * an event invitation needs Accept/Decline with character/role selection.
 */
import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvent } from '../../hooks/use-events';
import { useSignup } from '../../hooks/use-signups';
import { useNotifications } from '../../hooks/use-notifications';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { toast } from '../../lib/toast';

const SignupConfirmationModal = lazy(() =>
    import('./signup-confirmation-modal').then(m => ({ default: m.SignupConfirmationModal })),
);

interface EventInviteActionsProps {
    eventId: number;
    notificationId: string;
    /** Called after user accepts or declines */
    onComplete?: () => void;
}

export function EventInviteActions({
    eventId,
    notificationId,
    onComplete,
}: EventInviteActionsProps) {
    const navigate = useNavigate();
    const { markRead } = useNotifications();
    const { data: event } = useEvent(eventId);
    const { games } = useGameRegistry();
    const signup = useSignup(eventId);

    const [isAccepting, setIsAccepting] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [signupId, setSignupId] = useState<number | null>(null);

    // Resolve game registry data for character confirmation modal
    const gameRegistryEntry = games.find(
        (g) => g.id === event?.game?.registryId || g.slug === event?.game?.slug,
    );

    const handleAccept = async () => {
        setIsAccepting(true);
        try {
            const result = await signup.mutateAsync(undefined);
            markRead(notificationId);

            // If game has character selection, show confirmation modal
            if (result.id) {
                setSignupId(result.id);
                setShowConfirmation(true);
            } else {
                toast.success('Signed up!');
                navigate(`/events/${eventId}`);
                onComplete?.();
            }
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsAccepting(false);
        }
    };

    const handleDecline = () => {
        markRead(notificationId);
        onComplete?.();
    };

    const handleConfirmationClose = () => {
        setShowConfirmation(false);
        navigate(`/events/${eventId}`);
        onComplete?.();
    };

    return (
        <>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={handleAccept}
                    disabled={isAccepting}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors"
                >
                    {isAccepting ? 'Joining...' : 'Accept'}
                </button>
                <button
                    type="button"
                    onClick={handleDecline}
                    className="px-3 py-1.5 text-xs font-medium bg-panel hover:bg-overlay text-muted rounded-lg transition-colors"
                >
                    Decline
                </button>
            </div>

            {showConfirmation && signupId !== null && (
                <Suspense fallback={null}>
                    <SignupConfirmationModal
                        isOpen={showConfirmation}
                        onClose={handleConfirmationClose}
                        eventId={eventId}
                        signupId={signupId}
                        gameId={gameRegistryEntry?.id ?? event?.game?.registryId ?? undefined}
                        gameName={event?.game?.name ?? undefined}
                        hasRoles={gameRegistryEntry?.hasRoles ?? true}
                        gameSlug={event?.game?.slug ?? undefined}
                    />
                </Suspense>
            )}
        </>
    );
}

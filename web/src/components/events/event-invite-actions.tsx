/**
 * EventInviteActions — Reusable Accept/Decline buttons for event invitations (ROK-292).
 *
 * Mirrors the Discord embed flow:
 *   Accept → character selection modal → sign up → done
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
import type { CharacterRole } from '@raid-ledger/contract';

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

    const [showConfirmation, setShowConfirmation] = useState(false);

    // Resolve game config data for character confirmation modal
    // ROK-400: event.game.id is now the games table integer ID directly
    const gameRegistryEntry = games.find(
        (g) => g.id === event?.game?.id || g.slug === event?.game?.slug,
    );

    const handleAccept = () => {
        markRead(notificationId);
        // If game supports characters, open selection modal first
        if (event?.game?.id) {
            setShowConfirmation(true);
            return;
        }
        // No game — sign up directly
        doSignup();
    };

    const doSignup = async (characterId?: string) => {
        try {
            await signup.mutateAsync(characterId ? { characterId } : undefined);
            toast.success('Signed up!');
            navigate(`/events/${eventId}`);
            onComplete?.();
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleConfirm = async (selection: { characterId: string; role?: CharacterRole }) => {
        await doSignup(selection.characterId);
        setShowConfirmation(false);
    };

    const handleSkip = async () => {
        await doSignup();
        setShowConfirmation(false);
    };

    const handleDecline = () => {
        markRead(notificationId);
        onComplete?.();
    };

    const handleConfirmationClose = () => {
        setShowConfirmation(false);
    };

    return (
        <>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={handleAccept}
                    disabled={signup.isPending}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors"
                >
                    {signup.isPending ? 'Joining...' : 'Accept'}
                </button>
                <button
                    type="button"
                    onClick={handleDecline}
                    className="px-3 py-1.5 text-xs font-medium bg-panel hover:bg-overlay text-muted rounded-lg transition-colors"
                >
                    Decline
                </button>
            </div>

            {showConfirmation && (
                <Suspense fallback={null}>
                    <SignupConfirmationModal
                        isOpen={showConfirmation}
                        onClose={handleConfirmationClose}
                        onConfirm={handleConfirm}
                        onSkip={handleSkip}
                        isConfirming={signup.isPending}
                        gameId={gameRegistryEntry?.id ?? event?.game?.id ?? undefined}
                        gameName={event?.game?.name ?? undefined}
                        hasRoles={gameRegistryEntry?.hasRoles ?? true}
                        gameSlug={event?.game?.slug ?? undefined}
                    />
                </Suspense>
            )}
        </>
    );
}

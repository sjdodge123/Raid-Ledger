/**
 * EventInviteActions — Reusable Accept/Decline buttons for event invitations (ROK-292).
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
    onComplete?: () => void;
}

async function performSignup(
    signup: ReturnType<typeof useSignup>, navigate: ReturnType<typeof useNavigate>,
    eventId: number, onComplete: (() => void) | undefined,
    characterId?: string, preferredRoles?: CharacterRole[],
) {
    try {
        const options: { characterId?: string; preferredRoles?: string[] } = {};
        if (characterId) options.characterId = characterId;
        if (preferredRoles && preferredRoles.length > 0) options.preferredRoles = preferredRoles;
        await signup.mutateAsync(Object.keys(options).length > 0 ? options : undefined);
        toast.success('Signed up!');
        navigate(`/events/${eventId}`);
        onComplete?.();
    } catch (err) {
        toast.error('Failed to sign up', { description: err instanceof Error ? err.message : 'Please try again.' });
    }
}

function useInviteHandlers({ eventId, notificationId, onComplete }: EventInviteActionsProps) {
    const navigate = useNavigate();
    const { markRead } = useNotifications();
    const { data: event } = useEvent(eventId);
    const { games } = useGameRegistry();
    const signup = useSignup(eventId);
    const [showConfirmation, setShowConfirmation] = useState(false);

    const gameRegistryEntry = games.find((g) => g.id === event?.game?.id || g.slug === event?.game?.slug);

    const doSignup = (characterId?: string, preferredRoles?: CharacterRole[]) =>
        performSignup(signup, navigate, eventId, onComplete, characterId, preferredRoles);

    const handleAccept = () => {
        markRead(notificationId);
        if (event?.game?.id) { setShowConfirmation(true); return; }
        doSignup();
    };

    return { event, signup, showConfirmation, setShowConfirmation, gameRegistryEntry, doSignup, handleAccept, markRead, notificationId, onComplete };
}

function InviteConfirmationModal({ h, eventId }: { h: ReturnType<typeof useInviteHandlers>; eventId: number }) {
    if (!h.showConfirmation) return null;
    return (
        <Suspense fallback={null}>
            <SignupConfirmationModal
                isOpen={h.showConfirmation} onClose={() => h.setShowConfirmation(false)}
                onConfirm={async (sel: { characterId: string; role?: CharacterRole }) => { await h.doSignup(sel.characterId); h.setShowConfirmation(false); }}
                onSkip={async (opts?: { preferredRoles?: CharacterRole[] }) => { await h.doSignup(undefined, opts?.preferredRoles); h.setShowConfirmation(false); }}
                isConfirming={h.signup.isPending}
                gameId={h.gameRegistryEntry?.id ?? h.event?.game?.id ?? undefined}
                gameName={h.event?.game?.name ?? undefined}
                hasRoles={h.gameRegistryEntry?.hasRoles ?? true}
                gameSlug={h.event?.game?.slug ?? undefined} eventId={eventId} />
        </Suspense>
    );
}

export function EventInviteActions({ eventId, notificationId, onComplete }: EventInviteActionsProps) {
    const h = useInviteHandlers({ eventId, notificationId, onComplete });

    return (
        <>
            <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={h.handleAccept} disabled={h.signup.isPending}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors">
                    {h.signup.isPending ? 'Joining...' : 'Accept'}
                </button>
                <button type="button" onClick={() => { h.markRead(h.notificationId); h.onComplete?.(); }}
                    className="px-3 py-1.5 text-xs font-medium bg-panel hover:bg-overlay text-muted rounded-lg transition-colors">
                    Decline
                </button>
            </div>
            <InviteConfirmationModal h={h} eventId={eventId} />
        </>
    );
}

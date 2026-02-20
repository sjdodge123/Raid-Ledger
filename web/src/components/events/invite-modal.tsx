/**
 * InviteModal - Invite players to an event via Discord (ROK-292).
 * Features:
 * - Browse Discord server members with avatars (like impersonate menu)
 * - Search/filter members by username
 * - Manually enter a Discord username for non-server members
 * - Copy Event Link button
 * - Creates a PUG slot, which triggers the Discord DM invite flow
 *
 * The admin just picks WHO to invite. The invited player selects their
 * own character and role when they accept (via the Discord DM flow,
 * mirroring the signup embed).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import {
    listDiscordMembers,
    searchDiscordMembers,
    inviteMember,
    type DiscordMemberSearchResult,
} from '../../lib/api-client';
import { useCreatePug } from '../../hooks/use-pugs';

interface InviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    /** Discord usernames that already have PUG slots for this event */
    existingPugUsernames?: Set<string>;
    /** Discord IDs of users already signed up for this event */
    signedUpDiscordIds?: Set<string>;
}

export function InviteModal({
    isOpen,
    onClose,
    eventId,
    existingPugUsernames,
    signedUpDiscordIds,
}: InviteModalProps) {
    const createPug = useCreatePug(eventId);

    // Member list state
    const [members, setMembers] = useState<DiscordMemberSearchResult[]>([]);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Form state
    const [manualUsername, setManualUsername] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Load initial member list when modal opens
    useEffect(() => {
        if (isOpen) {
            setIsLoadingMembers(true);
            listDiscordMembers()
                .then(setMembers)
                .catch(() => setMembers([]))
                .finally(() => setIsLoadingMembers(false));
        }
    }, [isOpen]);

    // Debounced search — switches to server-side search when query >= 2 chars
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (value.trim().length < 2) {
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await searchDiscordMembers(value.trim());
                setMembers(results);
            } catch {
                // keep existing members on error
            } finally {
                setIsSearching(false);
            }
        }, 300);
    }, []);

    // Reload initial list when search is cleared
    useEffect(() => {
        if (searchQuery.trim().length === 0 && isOpen) {
            listDiscordMembers()
                .then(setMembers)
                .catch(() => {});
        }
    }, [searchQuery, isOpen]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
            setMembers([]);
            setManualUsername('');
            setIsSubmitting(false);
        }
    }, [isOpen]);

    // Client-side filter for short queries (< 2 chars)
    const displayMembers = searchQuery.trim().length >= 2
        ? members
        : members.filter((m) =>
            !searchQuery.trim() || m.username.toLowerCase().includes(searchQuery.toLowerCase())
        );

    const handlePugInvite = async (discordUsername: string, isOnServer = false) => {
        setIsSubmitting(true);
        try {
            await createPug.mutateAsync({ discordUsername, role: 'dps' });
            toast.success(
                isOnServer
                    ? `Invite sent to "${discordUsername}"`
                    : `Added "${discordUsername}" as a guest invite`,
                {
                    description: isOnServer
                        ? 'They\'ll receive a Discord DM with the invite.'
                        : 'They\'ll be invited via Discord once they join the server.',
                },
            );
            // Reset but keep modal open for more invites
            setManualUsername('');
            setSearchQuery('');
            // Reload initial members
            listDiscordMembers()
                .then(setMembers)
                .catch(() => {});
        } catch (err) {
            toast.error('Failed to send invite', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleMemberInvite = async (discordId: string, username: string) => {
        setIsSubmitting(true);
        try {
            await inviteMember(eventId, discordId);
            toast.success(`Invite sent to "${username}"`, {
                description: 'They\'ll receive a Discord DM with the invite.',
            });
            setSearchQuery('');
            listDiscordMembers()
                .then(setMembers)
                .catch(() => {});
        } catch (err) {
            toast.error('Failed to send invite', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    /** Check if a member is already invited, signed up, or a registered RL user */
    const getMemberStatus = (member: DiscordMemberSearchResult): 'invited' | 'signed_up' | 'member' | null => {
        if (existingPugUsernames?.has(member.username.toLowerCase())) return 'invited';
        if (signedUpDiscordIds?.has(member.discordId)) return 'signed_up';
        if (member.isRegistered) return 'member';
        return null;
    };

    const handleMemberClick = (member: DiscordMemberSearchResult) => {
        const status = getMemberStatus(member);
        if (status === 'invited' || status === 'signed_up') return;
        if (status === 'member') {
            // Registered member: send notification instead of PUG
            void handleMemberInvite(member.discordId, member.username);
        } else {
            // Non-registered server member: create PUG slot
            void handlePugInvite(member.username, true);
        }
    };

    const handleManualSubmit = () => {
        const trimmed = manualUsername.trim();
        if (!trimmed) return;
        void handlePugInvite(trimmed);
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            toast.success('Event link copied to clipboard!');
        }).catch(() => {
            toast.error('Failed to copy link');
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Invite Players" maxWidth="max-w-lg">
            <div className="space-y-4">
                {/* Copy Event Link */}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-panel border border-edge">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted truncate">
                            {window.location.href}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleCopyLink}
                        className="btn btn-secondary btn-sm shrink-0"
                    >
                        Copy URL
                    </button>
                </div>

                {/* Search input */}
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">
                        Discord Server Members
                    </label>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Search members..."
                        className="w-full px-3 py-2.5 rounded-lg border border-edge bg-panel text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                    />
                </div>

                {/* Member list */}
                <div className="max-h-56 overflow-y-auto rounded-lg border border-edge bg-surface">
                    {isLoadingMembers && members.length === 0 && (
                        <div className="px-3 py-4 text-center text-sm text-muted">
                            Loading members...
                        </div>
                    )}
                    {isSearching && (
                        <div className="px-3 py-2 text-center text-xs text-muted">
                            Searching...
                        </div>
                    )}
                    {displayMembers.map((member) => {
                        const status = getMemberStatus(member);
                        const isNonClickable = status === 'invited' || status === 'signed_up';
                        const isDisabled = isSubmitting || isNonClickable;
                        return (
                            <button
                                key={member.discordId}
                                type="button"
                                onClick={() => handleMemberClick(member)}
                                disabled={isDisabled}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${isNonClickable ? 'opacity-50 cursor-default' : 'hover:bg-panel disabled:opacity-50'}`}
                            >
                                {member.avatar ? (
                                    <img
                                        src={`https://cdn.discordapp.com/avatars/${member.discordId}/${member.avatar}.png?size=32`}
                                        alt=""
                                        className="w-7 h-7 rounded-full shrink-0"
                                    />
                                ) : (
                                    <div className="w-7 h-7 rounded-full bg-indigo-500/30 flex items-center justify-center shrink-0">
                                        <span className="text-xs font-bold text-indigo-300">
                                            {member.username[0]?.toUpperCase()}
                                        </span>
                                    </div>
                                )}
                                <span className="text-sm text-foreground font-medium truncate">
                                    {member.username}
                                </span>
                                <span className={`ml-auto text-xs shrink-0 ${
                                    status === 'invited' ? 'text-amber-400' :
                                    status === 'signed_up' ? 'text-emerald-400' :
                                    'text-indigo-400'
                                }`}>
                                    {status === 'invited' ? 'Already invited' :
                                     status === 'signed_up' ? 'Signed up' :
                                     'Invite'}
                                </span>
                            </button>
                        );
                    })}
                    {!isLoadingMembers && !isSearching && displayMembers.length === 0 && (
                        <p className="px-3 py-4 text-center text-xs text-muted">
                            {searchQuery.trim() ? `No members matching "${searchQuery}"` : 'No members found'}
                        </p>
                    )}
                </div>

                {/* Manual Username Entry */}
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">
                        Or Enter Discord Username
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={manualUsername}
                            onChange={(e) => setManualUsername(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
                            placeholder="username"
                            className="flex-1 px-3 py-2.5 rounded-lg border border-edge bg-panel text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                        />
                        <button
                            type="button"
                            onClick={handleManualSubmit}
                            disabled={!manualUsername.trim() || isSubmitting}
                            className="btn btn-primary btn-sm shrink-0"
                        >
                            {isSubmitting ? 'Sending...' : 'Send Invite'}
                        </button>
                    </div>
                    <p className="mt-1.5 text-xs text-dim">
                        For players not yet in the Discord server.
                    </p>
                </div>
            </div>
        </Modal>
    );
}

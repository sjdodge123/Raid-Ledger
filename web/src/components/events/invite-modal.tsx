/**
 * InviteModal - Invite players to an event via Discord (ROK-292, ROK-263).
 * Features:
 * - Browse Discord server members with avatars (like impersonate menu)
 * - Search/filter members by username
 * - "Invite a PUG" button generates magic invite link (ROK-263)
 * - Copy Event Link button
 * - Share to Discord channels button (ROK-263)
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
    shareEventToDiscord,
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
    /** Whether the event's game is an MMO (affects default PUG role) */
    isMMOGame?: boolean;
}

export function InviteModal({
    isOpen,
    onClose,
    eventId,
    existingPugUsernames,
    signedUpDiscordIds,
    isMMOGame = false,
}: InviteModalProps) {
    const createPug = useCreatePug(eventId);
    const defaultPugRole = isMMOGame ? 'dps' : 'player';

    // Member list state
    const [members, setMembers] = useState<DiscordMemberSearchResult[]>([]);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Form state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);

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
            setIsSubmitting(false);
            setGeneratedInviteUrl(null);
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
            await createPug.mutateAsync({ discordUsername, role: defaultPugRole });
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

    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            toast.success('Event link copied to clipboard!');
        }).catch(() => {
            toast.error('Failed to copy link');
        });
    };

    const handleShareToDiscord = async () => {
        setIsSharing(true);
        try {
            const result = await shareEventToDiscord(eventId);
            if (result.channelsPosted > 0) {
                toast.success(`Shared to ${result.channelsPosted} channel${result.channelsPosted > 1 ? 's' : ''}`, {
                    description: result.channelsSkipped > 0
                        ? `${result.channelsSkipped} channel${result.channelsSkipped > 1 ? 's' : ''} already had the event posted.`
                        : undefined,
                });
            } else if (result.channelsSkipped > 0) {
                toast.info('Already shared', {
                    description: 'This event was already posted to all bound channels.',
                });
            } else {
                toast.info('No channels configured', {
                    description: 'Set up game channel bindings in Admin Settings to share events.',
                });
            }
        } catch (err) {
            toast.error('Failed to share', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsSharing(false);
        }
    };

    const handleGenerateInviteLink = async () => {
        setIsSubmitting(true);
        try {
            const pugSlot = await createPug.mutateAsync({ role: defaultPugRole });
            if (!pugSlot.inviteCode) {
                toast.error('Failed to generate invite link', {
                    description: 'No invite code returned. Please try again.',
                });
                return;
            }
            const inviteUrl = `${window.location.origin}/i/${pugSlot.inviteCode}`;
            setGeneratedInviteUrl(inviteUrl);
            await navigator.clipboard.writeText(inviteUrl);
            toast.success('Invite link copied to clipboard!');
        } catch (err) {
            toast.error('Failed to generate invite link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Invite Players" maxWidth="max-w-lg">
            <div className="space-y-4">
                {/* Copy Event Link + Share to Discord */}
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
                    <button
                        type="button"
                        onClick={() => void handleShareToDiscord()}
                        disabled={isSharing}
                        className="btn btn-secondary btn-sm shrink-0"
                        title="Share to Discord channels"
                    >
                        {isSharing ? 'Sharing...' : 'Share'}
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

                {/* Invite a PUG — generate magic invite link (ROK-263) */}
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">
                        Invite a PUG
                    </label>
                    <button
                        type="button"
                        onClick={() => void handleGenerateInviteLink()}
                        disabled={isSubmitting}
                        className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2"
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        {isSubmitting ? 'Generating...' : 'Generate Invite Link'}
                    </button>
                    {generatedInviteUrl && (
                        <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-surface border border-edge">
                            <input
                                type="text"
                                readOnly
                                value={generatedInviteUrl}
                                className="flex-1 bg-transparent text-xs text-foreground border-none outline-none"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(generatedInviteUrl).then(() => {
                                        toast.success('Copied!');
                                    }).catch(() => {});
                                }}
                                className="shrink-0 text-xs text-dim hover:text-foreground transition-colors"
                                title="Copy invite link"
                            >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </button>
                        </div>
                    )}
                    <p className="mt-1.5 text-xs text-dim">
                        Creates a shareable link anyone can use to join this event.
                    </p>
                </div>
            </div>
        </Modal>
    );
}

/**
 * InviteModal - Invite players to an event via Discord (ROK-292).
 * Features:
 * - Search Discord server members by username
 * - Manually enter a Discord username for non-server members
 * - Role selection for MMO games (tank/healer/dps)
 * - Copy Event Link button
 * - Creates a PUG slot, which triggers the existing Discord DM invite flow
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { PugRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import {
    searchDiscordMembers,
    type DiscordMemberSearchResult,
} from '../../lib/api-client';
import { useCreatePug } from '../../hooks/use-pugs';

interface InviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    /** Whether the event's game is MMO (shows role selector) */
    isMMOGame: boolean;
}

const ROLES: { value: PugRole; label: string; emoji: string }[] = [
    { value: 'tank', label: 'Tank', emoji: '🛡️' },
    { value: 'healer', label: 'Healer', emoji: '💚' },
    { value: 'dps', label: 'DPS', emoji: '⚔️' },
];

export function InviteModal({
    isOpen,
    onClose,
    eventId,
    isMMOGame,
}: InviteModalProps) {
    const createPug = useCreatePug(eventId);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<DiscordMemberSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Form state
    const [manualUsername, setManualUsername] = useState('');
    const [selectedRole, setSelectedRole] = useState<PugRole>('dps');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Debounced search
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (value.trim().length < 2) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await searchDiscordMembers(value.trim());
                setSearchResults(results);
            } catch {
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 300);
    }, []);

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
            setSearchResults([]);
            setManualUsername('');
            setSelectedRole('dps');
            setIsSubmitting(false);
        }
    }, [isOpen]);

    const handleInvite = async (discordUsername: string) => {
        setIsSubmitting(true);
        try {
            await createPug.mutateAsync({
                discordUsername,
                role: isMMOGame ? selectedRole : 'dps',
            });
            toast.success(`Invite sent to "${discordUsername}"`);
            // Reset form but keep modal open for more invites
            setManualUsername('');
            setSearchQuery('');
            setSearchResults([]);
        } catch (err) {
            toast.error('Failed to send invite', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleMemberSelect = (member: DiscordMemberSearchResult) => {
        void handleInvite(member.username);
    };

    const handleManualInvite = () => {
        const trimmed = manualUsername.trim();
        if (!trimmed) return;
        void handleInvite(trimmed);
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
            <div className="space-y-5">
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

                {/* Role selector (MMO games only) */}
                {isMMOGame && (
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">
                            Role
                        </label>
                        <div className="flex gap-2">
                            {ROLES.map(({ value, label, emoji }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setSelectedRole(value)}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                        selectedRole === value
                                            ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 border'
                                            : 'bg-panel border border-edge text-muted hover:text-foreground hover:border-foreground/20'
                                    }`}
                                >
                                    {emoji} {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Discord Member Search */}
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">
                        Search Server Members
                    </label>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Type a Discord username..."
                        className="w-full px-3 py-2.5 rounded-lg border border-edge bg-panel text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                    />

                    {/* Search Results */}
                    {(searchResults.length > 0 || isSearching) && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-edge bg-surface">
                            {isSearching && searchResults.length === 0 && (
                                <div className="px-3 py-4 text-center text-sm text-muted">
                                    Searching...
                                </div>
                            )}
                            {searchResults.map((member) => (
                                <button
                                    key={member.discordId}
                                    type="button"
                                    onClick={() => handleMemberSelect(member)}
                                    disabled={isSubmitting}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-panel transition-colors text-left disabled:opacity-50"
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
                                    <span className="ml-auto text-xs text-indigo-400 shrink-0">
                                        Invite
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {searchQuery.trim().length >= 2 && !isSearching && searchResults.length === 0 && (
                        <p className="mt-2 text-xs text-muted">
                            No server members found matching "{searchQuery}"
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
                            onKeyDown={(e) => { if (e.key === 'Enter') handleManualInvite(); }}
                            placeholder="username"
                            className="flex-1 px-3 py-2.5 rounded-lg border border-edge bg-panel text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                        />
                        <button
                            type="button"
                            onClick={handleManualInvite}
                            disabled={!manualUsername.trim() || isSubmitting}
                            className="btn btn-primary btn-sm shrink-0"
                        >
                            {isSubmitting ? 'Sending...' : 'Send Invite'}
                        </button>
                    </div>
                    <p className="mt-1.5 text-xs text-dim">
                        For players not yet in the Discord server, they'll receive an invite link when they join.
                    </p>
                </div>
            </div>
        </Modal>
    );
}

import { useState, useMemo } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { PlayerCard } from '../events/player-card';
import { ROLE_EMOJI, ROLE_SLOT_COLORS, formatRole } from '../../lib/role-colors';
import './AssignmentPopup.css';

/** PUG-eligible roles (only MMO combat roles map to PugRole) */
const PUG_ELIGIBLE_ROLES = new Set<RosterRole>(['tank', 'healer', 'dps']);

/** A single slot for the slot picker (may be empty or occupied) */
export interface AvailableSlot {
    role: RosterRole;
    position: number;
    label: string;
    color: string;
    /** If occupied, the name of the player in this slot */
    occupantName?: string;
}

interface AssignmentPopupProps {
    isOpen: boolean;
    onClose: () => void;
    /** Event ID (needed for member invite endpoint) */
    eventId: number;
    /** Slot role to assign to (null = browsing all unassigned) */
    slotRole: RosterRole | null;
    /** Slot position (0 = browsing all) */
    slotPosition: number;
    /** Unassigned players */
    unassigned: RosterAssignmentResponse[];
    /** Current occupant of the slot (for swap/remove) */
    currentOccupant?: RosterAssignmentResponse;
    /** Called when admin clicks Assign on a player (slot already known) */
    onAssign: (signupId: number) => void;
    /** Called when admin clicks Remove to Unassigned */
    onRemove?: (signupId: number) => void;
    /** Called when admin wants to assign themselves (sign up + claim slot) */
    onSelfAssign?: () => void;
    /** Available empty slots for slot picker (browse-all mode) */
    availableSlots?: AvailableSlot[];
    /** Called when admin picks a slot for a player (browse-all mode) */
    onAssignToSlot?: (signupId: number, role: RosterRole, position: number) => void;
    /** Called when admin clicks "Invite a PUG" — generates invite link (ROK-263) */
    onGenerateInviteLink?: () => void;
}


/**
 * AssignmentPopup - Modal for assigning unassigned players to roster slots (ROK-208).
 * Two modes:
 * 1. Targeted: Opened from a specific slot click — shows player list, clicking Assign assigns directly.
 * 2. Browse-all: Opened from Unassigned bar — shows player list, clicking Assign opens slot picker.
 */
export function AssignmentPopup({
    isOpen,
    onClose,
    slotRole,
    slotPosition,
    unassigned,
    currentOccupant,
    onAssign,
    onRemove,
    onSelfAssign,
    availableSlots,
    onAssignToSlot,
    onGenerateInviteLink,
}: AssignmentPopupProps) {
    const [search, setSearch] = useState('');
    // For browse-all: selected player ID to show slot picker
    const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

    const isBrowseAll = slotRole === null;
    const selectedPlayer = selectedPlayerId != null
        ? unassigned.find(u => u.signupId === selectedPlayerId)
        : null;

    // Sort: matching role first, then alphabetical
    const { matching, other } = useMemo(() => {
        const lowerSearch = search.toLowerCase();
        const filtered = search
            ? unassigned.filter(u =>
                u.username.toLowerCase().includes(lowerSearch) ||
                u.character?.name?.toLowerCase().includes(lowerSearch)
            )
            : unassigned;

        if (!slotRole) {
            return { matching: [], other: filtered };
        }

        const match = filtered.filter(u => u.character?.role === slotRole);
        const rest = filtered.filter(u => u.character?.role !== slotRole);
        return { matching: match, other: rest };
    }, [unassigned, slotRole, search]);

    // Group available slots by role for the slot picker
    const slotsByRole = useMemo(() => {
        if (!availableSlots) return [];
        const groups = new Map<string, AvailableSlot[]>();
        for (const slot of availableSlots) {
            const existing = groups.get(slot.role) ?? [];
            existing.push(slot);
            groups.set(slot.role, existing);
        }
        return Array.from(groups.entries()).map(([role, slots]) => ({
            role,
            label: slots[0].label,
            slots,
        }));
    }, [availableSlots]);

    const title = selectedPlayer
        ? `Pick a slot for ${selectedPlayer.username}`
        : slotRole && slotPosition > 0
            ? `Assign to ${formatRole(slotRole)} ${slotPosition}`
            : 'Unassigned Players';

    const handleAssign = (signupId: number) => {
        if (isBrowseAll && onAssignToSlot && availableSlots) {
            // Browse-all mode: show slot picker
            setSelectedPlayerId(signupId);
        } else {
            // Targeted mode: assign directly
            onAssign(signupId);
            setSearch('');
        }
    };

    const handleSlotPick = (role: RosterRole, position: number) => {
        if (selectedPlayerId != null && onAssignToSlot) {
            onAssignToSlot(selectedPlayerId, role, position);
            setSelectedPlayerId(null);
            setSearch('');
        }
    };

    const handleBack = () => {
        setSelectedPlayerId(null);
    };

    const handleClose = () => {
        setSelectedPlayerId(null);
        setSearch('');
        onClose();
    };

    // Whether the invite section should be shown (targeted mode + MMO combat role)
    const canInvitePug = !isBrowseAll && slotRole !== null && PUG_ELIGIBLE_ROLES.has(slotRole) && !!onGenerateInviteLink;

    // Slot picker view: shown when a player is selected in browse-all mode
    if (selectedPlayer && availableSlots) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} title={title}>
                <div className="assignment-popup">
                    {/* Back button */}
                    <button
                        onClick={handleBack}
                        className="assignment-popup__back-btn"
                    >
                        ← Back to players
                    </button>

                    {/* Selected player info - uses PlayerCard for consistency (AC-1) */}
                    <PlayerCard
                        player={selectedPlayer}
                        size="default"
                        showRole
                    />

                    {/* Slot groups */}
                    {slotsByRole.map(({ role, label, slots }) => (
                        <div key={role} className="assignment-popup__section">
                            <h4 className="assignment-popup__section-title">
                                {ROLE_EMOJI[role] ?? '🎯'} {label}
                            </h4>
                            <div className="assignment-popup__slot-grid">
                                {slots.map(slot => {
                                    const colors = ROLE_SLOT_COLORS[slot.role] ?? ROLE_SLOT_COLORS.player;
                                    const isMatch = !slot.occupantName && selectedPlayer.character?.role === slot.role;
                                    const isLocked = !!slot.occupantName;
                                    return (
                                        <button
                                            key={`${slot.role}-${slot.position}`}
                                            onClick={() => !isLocked && handleSlotPick(slot.role, slot.position)}
                                            disabled={isLocked}
                                            className={`assignment-popup__slot-btn ${isLocked ? 'assignment-popup__slot-btn--locked'
                                                    : isMatch ? 'assignment-popup__slot-btn--match'
                                                        : ''}`}
                                            style={{
                                                '--slot-bg': isLocked ? 'rgba(30, 41, 59, 0.6)' : colors.bg,
                                                '--slot-border': isLocked ? 'rgba(51, 65, 85, 0.4)' : colors.border,
                                                '--slot-text': isLocked ? '#475569' : colors.text,
                                            } as React.CSSProperties}
                                        >
                                            <span className="assignment-popup__slot-label">
                                                {formatRole(slot.role)} {slot.position}
                                            </span>
                                            {isLocked && (
                                                <span className="assignment-popup__slot-occupant">
                                                    🔒 {slot.occupantName}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {slotsByRole.length === 0 && (
                        <div className="assignment-popup__empty">
                            No empty slots available.
                        </div>
                    )}
                </div>
            </Modal>
        );
    }

    // Player list view (default)
    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={title} maxWidth="max-w-md">
            <div className="assignment-popup">
                {/* Search filter */}
                <div className="assignment-popup__search-wrapper">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name..."
                        className="assignment-popup__search"
                        autoFocus
                    />
                </div>

                {/* Self-assign option for admins who aren't signed up */}
                {onSelfAssign && slotRole && slotPosition > 0 && (
                    <div className="assignment-popup__section">
                        <button
                            onClick={onSelfAssign}
                            className="assignment-popup__self-assign-btn"
                        >
                            🙋 Assign Myself to {formatRole(slotRole)} {slotPosition}
                        </button>
                    </div>
                )}

                {/* Current occupant removal option */}
                {currentOccupant && onRemove && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title assignment-popup__section-title--remove">
                            Current Occupant
                        </h4>
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <PlayerCard
                                    player={currentOccupant}
                                    size="compact"
                                    showRole
                                />
                            </div>
                            <button
                                onClick={() => onRemove(currentOccupant.signupId)}
                                className="assignment-popup__remove-btn"
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                )}

                {/* Matching Role section — AC-7: accent left-border */}
                {slotRole && matching.length > 0 && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title">
                            {ROLE_EMOJI[slotRole] ?? '🎯'} Matching Role — {formatRole(slotRole)}
                        </h4>
                        {matching.map(player => (
                            <ModalPlayerRow
                                key={player.signupId}
                                player={player}
                                onAssign={handleAssign}
                                accentColor={(ROLE_SLOT_COLORS[slotRole] ?? ROLE_SLOT_COLORS.player).border}
                            />
                        ))}
                    </div>
                )}

                {/* Other Unassigned section */}
                {other.length > 0 && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title">
                            {slotRole && matching.length > 0 ? 'Other Unassigned' : 'Unassigned Players'}
                        </h4>
                        {other.map(player => (
                            <ModalPlayerRow
                                key={player.signupId}
                                player={player}
                                onAssign={handleAssign}
                            />
                        ))}
                    </div>
                )}

                {/* Empty state — AC-5: clear messaging */}
                {matching.length === 0 && other.length === 0 && (
                    <div className="assignment-popup__empty">
                        {search
                            ? 'No players match your search.'
                            : 'All players are assigned to slots \u2713'}
                    </div>
                )}

                {/* ROK-263: Invite a PUG button (targeted mode, MMO roles only) */}
                {canInvitePug && (
                    <div className="assignment-popup__section">
                        <button
                            type="button"
                            onClick={() => {
                                onGenerateInviteLink?.();
                                handleClose();
                            }}
                            className="btn btn-primary btn-sm w-full flex items-center justify-center gap-2"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Invite a PUG
                        </button>
                        <p className="mt-1.5 text-xs text-dim">
                            Generate a shareable invite link for this slot.
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
}

/**
 * Individual player row in the assignment modal.
 * Uses shared PlayerCard (AC-1) with an Assign button alongside.
 * Matching-role rows get an accent left-border (AC-7).
 */
function ModalPlayerRow({
    player,
    onAssign,
    accentColor,
}: {
    player: RosterAssignmentResponse;
    onAssign: (signupId: number) => void;
    accentColor?: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
                <PlayerCard
                    player={player}
                    size="compact"
                    showRole
                    matchAccent={accentColor}
                />
            </div>
            <button
                onClick={() => onAssign(player.signupId)}
                className="assignment-popup__assign-btn"
            >
                Assign
            </button>
        </div>
    );
}

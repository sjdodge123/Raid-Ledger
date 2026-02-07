import { useState, useMemo } from 'react';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import './AssignmentPopup.css';

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
}

/** Capitalize first letter */
function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Role emoji icons */
const ROLE_EMOJI: Record<string, string> = {
    tank: '🛡️',
    healer: '💚',
    dps: '⚔️',
    flex: '🔄',
    player: '🎮',
    bench: '💺',
};

/** Role color classes for slot buttons */
const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    tank: { bg: 'rgba(37, 99, 235, 0.15)', border: 'rgba(37, 99, 235, 0.4)', text: '#93c5fd' },
    healer: { bg: 'rgba(22, 163, 74, 0.15)', border: 'rgba(22, 163, 74, 0.4)', text: '#86efac' },
    dps: { bg: 'rgba(220, 38, 38, 0.15)', border: 'rgba(220, 38, 38, 0.4)', text: '#fca5a5' },
    flex: { bg: 'rgba(147, 51, 234, 0.15)', border: 'rgba(147, 51, 234, 0.4)', text: '#c4b5fd' },
    player: { bg: 'rgba(99, 102, 241, 0.15)', border: 'rgba(99, 102, 241, 0.4)', text: '#a5b4fc' },
    bench: { bg: 'rgba(100, 116, 139, 0.15)', border: 'rgba(100, 116, 139, 0.4)', text: '#94a3b8' },
};

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
            ? `Assign to ${capitalize(slotRole)} ${slotPosition}`
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

                    {/* Selected player info */}
                    <div className="assignment-popup__selected-player">
                        <AvatarWithFallback
                            avatarUrl={selectedPlayer.character?.avatarUrl ?? selectedPlayer.avatar}
                            username={selectedPlayer.username}
                            sizeClassName="h-10 w-10"
                        />
                        <div className="assignment-popup__player-details">
                            <span className="assignment-popup__player-name">{selectedPlayer.username}</span>
                            {selectedPlayer.character && (
                                <span className="assignment-popup__player-character">
                                    {selectedPlayer.character.name}
                                    {selectedPlayer.character.className && ` • ${selectedPlayer.character.className}`}
                                </span>
                            )}
                        </div>
                        {selectedPlayer.character?.role && (
                            <span className={`assignment-popup__role-badge ${selectedPlayer.character.role === 'tank'
                                ? 'assignment-popup__role-badge--tank'
                                : selectedPlayer.character.role === 'healer'
                                    ? 'assignment-popup__role-badge--healer'
                                    : 'assignment-popup__role-badge--dps'
                                }`}>
                                {ROLE_EMOJI[selectedPlayer.character.role] ?? ''} {capitalize(selectedPlayer.character.role)}
                            </span>
                        )}
                    </div>

                    {/* Slot groups */}
                    {slotsByRole.map(({ role, label, slots }) => (
                        <div key={role} className="assignment-popup__section">
                            <h4 className="assignment-popup__section-title">
                                {ROLE_EMOJI[role] ?? '🎯'} {label}
                            </h4>
                            <div className="assignment-popup__slot-grid">
                                {slots.map(slot => {
                                    const colors = ROLE_COLORS[slot.role] ?? ROLE_COLORS.player;
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
                                                {capitalize(slot.role)} {slot.position}
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
        <Modal isOpen={isOpen} onClose={handleClose} title={title}>
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
                            🙋 Assign Myself to {capitalize(slotRole)} {slotPosition}
                        </button>
                    </div>
                )}

                {/* Current occupant removal option */}
                {currentOccupant && onRemove && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title assignment-popup__section-title--remove">
                            Current Occupant
                        </h4>
                        <div className="assignment-popup__player-row assignment-popup__player-row--current">
                            <div className="assignment-popup__player-info">
                                <AvatarWithFallback
                                    avatarUrl={currentOccupant.character?.avatarUrl ?? currentOccupant.avatar}
                                    username={currentOccupant.username}
                                    sizeClassName="h-8 w-8"
                                />
                                <div className="assignment-popup__player-details">
                                    <span className="assignment-popup__player-name">{currentOccupant.username}</span>
                                    {currentOccupant.character && (
                                        <span className="assignment-popup__player-character">
                                            {currentOccupant.character.name}
                                            {currentOccupant.character.className && ` • ${currentOccupant.character.className}`}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => onRemove(currentOccupant.signupId)}
                                className="assignment-popup__remove-btn"
                            >
                                Remove to Unassigned
                            </button>
                        </div>
                    </div>
                )}

                {/* Matching Role section */}
                {slotRole && matching.length > 0 && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title">
                            {ROLE_EMOJI[slotRole] ?? '🎯'} Matching Role — {capitalize(slotRole)}
                        </h4>
                        {matching.map(player => (
                            <PlayerRow
                                key={player.signupId}
                                player={player}
                                onAssign={handleAssign}
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
                            <PlayerRow
                                key={player.signupId}
                                player={player}
                                onAssign={handleAssign}
                            />
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {matching.length === 0 && other.length === 0 && (
                    <div className="assignment-popup__empty">
                        {search ? 'No players match your search.' : 'All players are assigned.'}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/** Individual player row in the assignment popup */
function PlayerRow({
    player,
    onAssign,
}: {
    player: RosterAssignmentResponse;
    onAssign: (signupId: number) => void;
}) {
    const roleEmoji = player.character?.role ? ROLE_EMOJI[player.character.role] ?? '' : '';

    return (
        <div className="assignment-popup__player-row">
            <div className="assignment-popup__player-info">
                <AvatarWithFallback
                    avatarUrl={player.character?.avatarUrl ?? player.avatar}
                    username={player.username}
                    sizeClassName="h-8 w-8"
                />
                <div className="assignment-popup__player-details">
                    <span className="assignment-popup__player-name">{player.username}</span>
                    {player.character && (
                        <span className="assignment-popup__player-character">
                            {player.character.name}
                            {player.character.className && ` • ${player.character.className}`}
                        </span>
                    )}
                </div>
                {player.character?.role && (
                    <span className={`assignment-popup__role-badge ${player.character.role === 'tank'
                        ? 'assignment-popup__role-badge--tank'
                        : player.character.role === 'healer'
                            ? 'assignment-popup__role-badge--healer'
                            : 'assignment-popup__role-badge--dps'
                        }`}>
                        {roleEmoji} {capitalize(player.character.role)}
                    </span>
                )}
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

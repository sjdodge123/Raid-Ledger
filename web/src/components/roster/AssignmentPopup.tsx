import { useState, useMemo } from 'react';
import type { RosterAssignmentResponse, RosterRole, CharacterDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { PlayerCard } from '../events/player-card';
import { ROLE_SLOT_COLORS, formatRole } from '../../lib/role-colors';
import { RoleIcon } from '../shared/RoleIcon';
import { getClassIconUrl } from '../../plugins/wow/lib/class-icons';
import { useUserCharacters } from '../../hooks/use-characters';
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

/** ROK-461: Data from character/role selection step */
export interface AssignmentSelection {
    signupId: number;
    characterId?: string;
    role?: RosterRole;
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
    /** ROK-461: Called when admin confirms assignment with optional character/role */
    onAssign: (signupId: number, selection?: { characterId?: string; role?: RosterRole }) => void;
    /** Called when admin clicks Remove to Unassigned */
    onRemove?: (signupId: number) => void;
    /** Called when admin wants to assign themselves (sign up + claim slot) */
    onSelfAssign?: () => void;
    /** Available empty slots for slot picker (browse-all mode) */
    availableSlots?: AvailableSlot[];
    /** Called when admin picks a slot for a player (browse-all mode) */
    onAssignToSlot?: (signupId: number, role: RosterRole, position: number, selection?: { characterId?: string }) => void;
    /** Called when admin clicks "Invite a PUG" — generates invite link (ROK-263) */
    onGenerateInviteLink?: () => void;
    /** ROK-402: Called when admin removes a signup from the event entirely */
    onRemoveFromEvent?: (signupId: number, username: string) => void;
    /** ROK-390: Called when admin reassigns occupant to another slot (move or swap) */
    onReassignToSlot?: (
        fromSignupId: number,
        toRole: RosterRole,
        toPosition: number,
    ) => void;
    /** ROK-461: Game ID for fetching player's characters */
    gameId?: number;
    /** ROK-461: Whether this is an MMO event with roles */
    isMMO?: boolean;
}


/**
 * AssignmentPopup - Modal for assigning unassigned players to roster slots (ROK-208).
 * Two modes:
 * 1. Targeted: Opened from a specific slot click — shows player list, clicking Assign assigns directly.
 * 2. Browse-all: Opened from Unassigned bar — shows player list, clicking Assign opens slot picker.
 *
 * ROK-461: After admin selects a player, shows character/role selection step before confirming.
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
    onRemoveFromEvent,
    onReassignToSlot,
    gameId,
}: AssignmentPopupProps) {
    const [search, setSearch] = useState('');
    // For browse-all: selected player ID to show slot picker
    const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
    // ROK-390: Reassign mode — shows slot picker for moving current occupant
    const [reassignMode, setReassignMode] = useState(false);
    // ROK-461: Character/role selection step
    const [selectionTarget, setSelectionTarget] = useState<RosterAssignmentResponse | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<RosterRole | null>(null);

    const isBrowseAll = slotRole === null;
    const selectedPlayer = selectedPlayerId != null
        ? unassigned.find(u => u.signupId === selectedPlayerId)
        : null;

    // ROK-461: Fetch characters for the player being assigned
    const { data: playerCharacters, isLoading: isLoadingCharacters } = useUserCharacters(
        selectionTarget?.userId ?? null,
        gameId,
    );

    // Sort: matching role first (character role OR preferred roles), then alphabetical
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

        // ROK-452: Match by character role OR preferred roles
        const match = filtered.filter(u =>
            u.character?.role === slotRole ||
            (u.preferredRoles && u.preferredRoles.includes(slotRole as 'tank' | 'healer' | 'dps'))
        );
        const matchIds = new Set(match.map(u => u.signupId));
        const rest = filtered.filter(u => !matchIds.has(u.signupId));
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

    const title = selectionTarget
        ? `Select Character for ${selectionTarget.username}`
        : reassignMode && currentOccupant
            ? `Reassign ${currentOccupant.username}`
            : selectedPlayer
                ? `Pick a slot for ${selectedPlayer.username}`
                : slotRole && slotPosition > 0
                    ? `Assign to ${formatRole(slotRole)} ${slotPosition}`
                    : 'Unassigned Players';

    // ROK-461: Enter character selection step for a player
    const enterSelectionStep = (player: RosterAssignmentResponse) => {
        // If game has no characters (no gameId), skip selection step
        if (!gameId) {
            if (isBrowseAll && onAssignToSlot && availableSlots) {
                setSelectedPlayerId(player.signupId);
            } else {
                onAssign(player.signupId);
                setSearch('');
            }
            return;
        }
        setSelectionTarget(player);
        setSelectedCharacterId(player.character?.id ?? null);
        setSelectedRole(slotRole);
    };

    const handleAssign = (signupId: number) => {
        const player = unassigned.find(u => u.signupId === signupId);
        if (!player) return;

        if (isBrowseAll && onAssignToSlot && availableSlots) {
            // Browse-all mode: enter selection step, then show slot picker
            if (gameId) {
                // Enter selection, but remember we need slot picker after
                enterSelectionStep(player);
            } else {
                setSelectedPlayerId(signupId);
            }
        } else {
            // Targeted mode: enter selection step
            enterSelectionStep(player);
        }
    };

    // ROK-461: Confirm character/role selection and proceed
    const handleSelectionConfirm = () => {
        if (!selectionTarget) return;
        const selection = {
            characterId: selectedCharacterId ?? undefined,
            role: selectedRole ?? undefined,
        };

        if (isBrowseAll && onAssignToSlot && availableSlots) {
            // After selection, show slot picker
            setSelectedPlayerId(selectionTarget.signupId);
            // Store selection data on the target for later use
            setSelectionTarget(null);
        } else {
            // Targeted mode: assign with selection
            onAssign(selectionTarget.signupId, selection);
            setSelectionTarget(null);
            setSelectedCharacterId(null);
            setSelectedRole(null);
            setSearch('');
        }
    };

    // ROK-461: Skip character selection (no characters or admin chooses to skip)
    const handleSelectionSkip = () => {
        if (!selectionTarget) return;

        if (isBrowseAll && onAssignToSlot && availableSlots) {
            setSelectedPlayerId(selectionTarget.signupId);
            setSelectionTarget(null);
        } else {
            onAssign(selectionTarget.signupId);
            setSelectionTarget(null);
            setSelectedCharacterId(null);
            setSelectedRole(null);
            setSearch('');
        }
    };

    const handleSlotPick = (role: RosterRole, position: number) => {
        if (selectedPlayerId != null && onAssignToSlot) {
            onAssignToSlot(selectedPlayerId, role, position, {
                characterId: selectedCharacterId ?? undefined,
            });
            setSelectedPlayerId(null);
            setSelectedCharacterId(null);
            setSelectedRole(null);
            setSearch('');
        }
    };

    const handleBack = () => {
        if (selectionTarget) {
            setSelectionTarget(null);
            setSelectedCharacterId(null);
            setSelectedRole(null);
        } else if (reassignMode) {
            setReassignMode(false);
        } else {
            setSelectedPlayerId(null);
        }
    };

    const handleClose = () => {
        setSelectedPlayerId(null);
        setReassignMode(false);
        setSelectionTarget(null);
        setSelectedCharacterId(null);
        setSelectedRole(null);
        setSearch('');
        onClose();
    };

    // ROK-390: Handle slot pick during reassign mode
    const handleReassignSlotPick = (role: RosterRole, position: number) => {
        if (currentOccupant && onReassignToSlot) {
            onReassignToSlot(currentOccupant.signupId, role, position);
            setReassignMode(false);
        }
    };

    // Whether the invite section should be shown (targeted mode + MMO combat role)
    const canInvitePug = !isBrowseAll && slotRole !== null && PUG_ELIGIBLE_ROLES.has(slotRole) && !!onGenerateInviteLink;

    // ROK-461: Character/role selection step view
    if (selectionTarget) {
        const characters = playerCharacters ?? [];
        const mainCharacter = characters.find((c: CharacterDto) => c.isMain);
        const altCharacters = characters.filter((c: CharacterDto) => !c.isMain);
        const hasCharacters = characters.length > 0;

        return (
            <Modal isOpen={isOpen} onClose={handleClose} title={title}>
                <div className="assignment-popup">
                    <button
                        onClick={handleBack}
                        className="assignment-popup__back-btn"
                    >
                        &larr; Back to players
                    </button>

                    <PlayerCard
                        player={selectionTarget}
                        size="default"
                    />

                    {/* Loading state */}
                    {isLoadingCharacters && (
                        <div className="space-y-3 mt-3">
                            {[1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="h-14 bg-panel rounded-lg animate-pulse"
                                />
                            ))}
                        </div>
                    )}

                    {/* No characters */}
                    {!isLoadingCharacters && !hasCharacters && (
                        <div className="assignment-popup__section">
                            <p className="text-sm text-muted text-center py-3">
                                This player has no characters for this game.
                            </p>
                            <button
                                onClick={handleSelectionSkip}
                                className="btn btn-primary btn-sm w-full"
                            >
                                Assign Without Character
                            </button>
                        </div>
                    )}

                    {/* Character picker */}
                    {!isLoadingCharacters && hasCharacters && (
                        <>
                            {/* Main character */}
                            {mainCharacter && (
                                <div className="assignment-popup__section">
                                    <h4 className="assignment-popup__section-title">
                                        Main Character
                                    </h4>
                                    <SelectableCharacterCard
                                        character={mainCharacter}
                                        isSelected={selectedCharacterId === mainCharacter.id}
                                        onSelect={() => {
                                            setSelectedCharacterId(mainCharacter.id);
                                            if (!slotRole && mainCharacter.effectiveRole) {
                                                setSelectedRole(mainCharacter.effectiveRole as RosterRole);
                                            }
                                        }}
                                        isMain
                                    />
                                </div>
                            )}

                            {/* Alt characters */}
                            {altCharacters.length > 0 && (
                                <div className="assignment-popup__section">
                                    <h4 className="assignment-popup__section-title">
                                        Alt Characters
                                    </h4>
                                    <div className="space-y-1.5">
                                        {altCharacters.map((char: CharacterDto) => (
                                            <SelectableCharacterCard
                                                key={char.id}
                                                character={char}
                                                isSelected={selectedCharacterId === char.id}
                                                onSelect={() => {
                                                    setSelectedCharacterId(char.id);
                                                    if (!slotRole && char.effectiveRole) {
                                                        setSelectedRole(char.effectiveRole as RosterRole);
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Confirm button */}
                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={handleSelectionSkip}
                                    className="btn btn-secondary btn-sm flex-1"
                                >
                                    Skip
                                </button>
                                <button
                                    onClick={handleSelectionConfirm}
                                    disabled={!selectedCharacterId}
                                    className="btn btn-primary btn-sm flex-1"
                                >
                                    Confirm &amp; Assign
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
        );
    }

    // ROK-390: Reassign slot picker view — shown when admin clicks "Reassign" on an occupied slot
    if (reassignMode && currentOccupant && availableSlots) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} title={title}>
                <div className="assignment-popup">
                    <button
                        onClick={handleBack}
                        className="assignment-popup__back-btn"
                    >
                        &larr; Back
                    </button>

                    <PlayerCard
                        player={currentOccupant}
                        size="default"
                        showRole
                    />

                    {slotsByRole.map(({ role, label, slots }) => (
                        <div key={role} className="assignment-popup__section">
                            <h4 className="assignment-popup__section-title">
                                <RoleIcon role={role} size="w-4 h-4" /> {label}
                            </h4>
                            <div className="assignment-popup__slot-grid">
                                {slots.map(slot => {
                                    const colors = ROLE_SLOT_COLORS[slot.role] ?? ROLE_SLOT_COLORS.player;
                                    const isCurrent = slot.role === slotRole && slot.position === slotPosition;
                                    const isOccupied = !!slot.occupantName && !isCurrent;
                                    const isEmpty = !slot.occupantName;
                                    const isMatch = isEmpty && currentOccupant.character?.role === slot.role;

                                    return (
                                        <button
                                            key={`${slot.role}-${slot.position}`}
                                            onClick={() => !isCurrent && handleReassignSlotPick(slot.role, slot.position)}
                                            disabled={isCurrent}
                                            className={`assignment-popup__slot-btn ${
                                                isCurrent ? 'assignment-popup__slot-btn--locked'
                                                    : isOccupied ? 'assignment-popup__slot-btn--swap'
                                                        : isMatch ? 'assignment-popup__slot-btn--match'
                                                            : ''
                                            }`}
                                            style={{
                                                '--slot-bg': isCurrent ? 'rgba(30, 41, 59, 0.6)'
                                                    : isOccupied ? 'rgba(245, 158, 11, 0.08)'
                                                        : colors.bg,
                                                '--slot-border': isCurrent ? 'rgba(51, 65, 85, 0.4)'
                                                    : isOccupied ? 'rgba(245, 158, 11, 0.4)'
                                                        : colors.border,
                                                '--slot-text': isCurrent ? '#475569'
                                                    : isOccupied ? '#fbbf24'
                                                        : colors.text,
                                            } as React.CSSProperties}
                                        >
                                            <span className="assignment-popup__slot-label">
                                                {formatRole(slot.role)} {slot.position}
                                            </span>
                                            {isCurrent && (
                                                <span className="assignment-popup__slot-occupant">
                                                    (current)
                                                </span>
                                            )}
                                            {isOccupied && (
                                                <span className="assignment-popup__slot-occupant">
                                                    &harr; {slot.occupantName}
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
                            No slots available.
                        </div>
                    )}
                </div>
            </Modal>
        );
    }

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
                        &larr; Back to players
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
                                <RoleIcon role={role} size="w-4 h-4" /> {label}
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
                                                    {slot.occupantName}
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
                            Assign Myself to {formatRole(slotRole)} {slotPosition}
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
                            <div className="flex flex-col gap-1 shrink-0">
                                {onReassignToSlot && (
                                    <button
                                        onClick={() => setReassignMode(true)}
                                        className="assignment-popup__reassign-btn"
                                    >
                                        Reassign
                                    </button>
                                )}
                                <button
                                    onClick={() => onRemove(currentOccupant.signupId)}
                                    className="assignment-popup__remove-btn"
                                >
                                    Unassign
                                </button>
                                {onRemoveFromEvent && (
                                    <button
                                        onClick={() => {
                                            onRemoveFromEvent(currentOccupant.signupId, currentOccupant.username);
                                            handleClose();
                                        }}
                                        className="assignment-popup__remove-event-btn"
                                    >
                                        Remove from event
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Matching Role section — AC-7: accent left-border */}
                {slotRole && matching.length > 0 && (
                    <div className="assignment-popup__section">
                        <h4 className="assignment-popup__section-title">
                            <RoleIcon role={slotRole} size="w-4 h-4" /> Matching Role — {formatRole(slotRole)}
                        </h4>
                        {matching.map(player => (
                            <ModalPlayerRow
                                key={player.signupId}
                                player={player}
                                onAssign={handleAssign}
                                accentColor={(ROLE_SLOT_COLORS[slotRole] ?? ROLE_SLOT_COLORS.player).border}
                                onRemoveFromEvent={onRemoveFromEvent}
                                onClose={handleClose}
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
                                onRemoveFromEvent={onRemoveFromEvent}
                                onClose={handleClose}
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
    onRemoveFromEvent,
    onClose,
}: {
    player: RosterAssignmentResponse;
    onAssign: (signupId: number) => void;
    accentColor?: string;
    onRemoveFromEvent?: (signupId: number, username: string) => void;
    onClose?: () => void;
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
            <div className="flex gap-1 shrink-0">
                <button
                    onClick={() => onAssign(player.signupId)}
                    className="assignment-popup__assign-btn"
                >
                    Assign
                </button>
                {onRemoveFromEvent && (
                    <button
                        onClick={() => {
                            onRemoveFromEvent(player.signupId, player.username);
                            onClose?.();
                        }}
                        className="assignment-popup__remove-event-btn"
                        title={`Remove ${player.username} from event`}
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * ROK-461: Selectable character card for admin assignment flow.
 */
function SelectableCharacterCard({
    character,
    isSelected,
    onSelect,
    isMain,
}: {
    character: CharacterDto;
    isSelected: boolean;
    onSelect: () => void;
    isMain?: boolean;
}) {
    return (
        <button
            onClick={onSelect}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${isSelected
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-edge bg-panel/50 hover:border-edge-strong hover:bg-panel'
                }`}
        >
            {character.avatarUrl ? (
                <img
                    src={character.avatarUrl}
                    alt={character.name}
                    className="w-10 h-10 rounded-full bg-overlay"
                />
            ) : (
                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-lg">
                    {character.name.charAt(0).toUpperCase()}
                </div>
            )}

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                        {character.name}
                    </span>
                    {isMain && (
                        <span className="text-yellow-400 text-sm" title="Main Character">
                            *
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                    {character.level && <span>Lv.{character.level}</span>}
                    {character.level && character.class && <span>·</span>}
                    {character.class && (
                        <span className="inline-flex items-center gap-1">
                            {getClassIconUrl(character.class) && (
                                <img src={getClassIconUrl(character.class)!} alt="" className="w-4 h-4 rounded-sm" />
                            )}
                            {character.class}
                        </span>
                    )}
                    {character.spec && (
                        <>
                            <span>·</span>
                            <span>{character.spec}</span>
                        </>
                    )}
                    {character.itemLevel && (
                        <>
                            <span>·</span>
                            <span className="text-purple-400">{character.itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>

            {isSelected && (
                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <svg
                        className="w-3 h-3 text-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>
            )}
        </button>
    );
}

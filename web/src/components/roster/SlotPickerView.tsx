import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { PlayerCard } from '../events/player-card';
import { ROLE_SLOT_COLORS, formatRole } from '../../lib/role-colors';
import { RoleIcon } from '../shared/RoleIcon';
import type { AvailableSlot, SlotGroup } from './assignment-popup.types';

interface SlotPickerViewProps {
    isOpen: boolean;
    title: string;
    player: RosterAssignmentResponse;
    slotsByRole: SlotGroup[];
    onSlotPick: (role: RosterRole, position: number) => void;
    onBack: () => void;
    onClose: () => void;
}

export function SlotPickerView({
    isOpen, title, player, slotsByRole, onSlotPick, onBack, onClose,
}: SlotPickerViewProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="assignment-popup">
                <button onClick={onBack} className="assignment-popup__back-btn">
                    &larr; Back to players
                </button>
                <PlayerCard player={player} size="default" showRole />
                {slotsByRole.map(({ role, label, slots }) => (
                    <SlotRoleGroup
                        key={role} role={role} label={label} slots={slots}
                        playerRole={player.character?.role}
                        onSlotPick={onSlotPick}
                    />
                ))}
                {slotsByRole.length === 0 && (
                    <div className="assignment-popup__empty">No empty slots available.</div>
                )}
            </div>
        </Modal>
    );
}

interface ReassignSlotPickerViewProps {
    isOpen: boolean;
    title: string;
    currentOccupant: RosterAssignmentResponse;
    slotsByRole: SlotGroup[];
    slotRole: RosterRole | null;
    slotPosition: number;
    onSlotPick: (role: RosterRole, position: number) => void;
    onBack: () => void;
    onClose: () => void;
}

export function ReassignSlotPickerView({
    isOpen, title, currentOccupant, slotsByRole,
    slotRole, slotPosition, onSlotPick, onBack, onClose,
}: ReassignSlotPickerViewProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="assignment-popup">
                <button onClick={onBack} className="assignment-popup__back-btn">
                    &larr; Back
                </button>
                <PlayerCard player={currentOccupant} size="default" showRole />
                {slotsByRole.map(({ role, label, slots }) => (
                    <ReassignSlotRoleGroup
                        key={role} role={role} label={label} slots={slots}
                        currentOccupant={currentOccupant}
                        slotRole={slotRole} slotPosition={slotPosition}
                        onSlotPick={onSlotPick}
                    />
                ))}
                {slotsByRole.length === 0 && (
                    <div className="assignment-popup__empty">No slots available.</div>
                )}
            </div>
        </Modal>
    );
}

function SlotRoleGroup({
    role, label, slots, playerRole, onSlotPick,
}: {
    role: string; label: string; slots: AvailableSlot[];
    playerRole?: string; onSlotPick: (role: RosterRole, position: number) => void;
}) {
    return (
        <div className="assignment-popup__section">
            <h4 className="assignment-popup__section-title">
                <RoleIcon role={role} size="w-4 h-4" /> {label}
            </h4>
            <div className="assignment-popup__slot-grid">
                {slots.map(slot => {
                    const colors = ROLE_SLOT_COLORS[slot.role] ?? ROLE_SLOT_COLORS.player;
                    const isMatch = !slot.occupantName && playerRole === slot.role;
                    const isLocked = !!slot.occupantName;
                    return (
                        <button
                            key={`${slot.role}-${slot.position}`}
                            onClick={() => !isLocked && onSlotPick(slot.role, slot.position)}
                            disabled={isLocked}
                            className={`assignment-popup__slot-btn ${isLocked ? 'assignment-popup__slot-btn--locked' : isMatch ? 'assignment-popup__slot-btn--match' : ''}`}
                            style={{
                                '--slot-bg': isLocked ? 'rgba(30, 41, 59, 0.6)' : colors.bg,
                                '--slot-border': isLocked ? 'rgba(51, 65, 85, 0.4)' : colors.border,
                                '--slot-text': isLocked ? '#475569' : colors.text,
                            } as React.CSSProperties}
                        >
                            <span className="assignment-popup__slot-label">{formatRole(slot.role)} {slot.position}</span>
                            {isLocked && <span className="assignment-popup__slot-occupant">{slot.occupantName}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ReassignSlotRoleGroup({
    role, label, slots, currentOccupant, slotRole, slotPosition, onSlotPick,
}: {
    role: string; label: string; slots: AvailableSlot[];
    currentOccupant: RosterAssignmentResponse;
    slotRole: RosterRole | null; slotPosition: number;
    onSlotPick: (role: RosterRole, position: number) => void;
}) {
    return (
        <div className="assignment-popup__section">
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
                            onClick={() => !isCurrent && onSlotPick(slot.role, slot.position)}
                            disabled={isCurrent}
                            className={`assignment-popup__slot-btn ${isCurrent ? 'assignment-popup__slot-btn--locked' : isOccupied ? 'assignment-popup__slot-btn--swap' : isMatch ? 'assignment-popup__slot-btn--match' : ''}`}
                            style={{
                                '--slot-bg': isCurrent ? 'rgba(30, 41, 59, 0.6)' : isOccupied ? 'rgba(245, 158, 11, 0.08)' : colors.bg,
                                '--slot-border': isCurrent ? 'rgba(51, 65, 85, 0.4)' : isOccupied ? 'rgba(245, 158, 11, 0.4)' : colors.border,
                                '--slot-text': isCurrent ? '#475569' : isOccupied ? '#fbbf24' : colors.text,
                            } as React.CSSProperties}
                        >
                            <span className="assignment-popup__slot-label">{formatRole(slot.role)} {slot.position}</span>
                            {isCurrent && <span className="assignment-popup__slot-occupant">(current)</span>}
                            {isOccupied && <span className="assignment-popup__slot-occupant">&harr; {slot.occupantName}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

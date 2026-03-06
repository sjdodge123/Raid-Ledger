import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';

/** PUG-eligible roles (MMO combat roles + generic 'player' role) */
export const PUG_ELIGIBLE_ROLES = new Set<RosterRole>(['tank', 'healer', 'dps', 'player']);

/** A single slot for the slot picker (may be empty or occupied) */
export interface AvailableSlot {
    role: RosterRole;
    position: number;
    label: string;
    color: string;
    occupantName?: string;
}

/** ROK-461: Data from character/role selection step */
export interface AssignmentSelection {
    signupId: number;
    characterId?: string;
    role?: RosterRole;
}

export interface AssignmentPopupProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    slotRole: RosterRole | null;
    slotPosition: number;
    unassigned: RosterAssignmentResponse[];
    currentOccupant?: RosterAssignmentResponse;
    onAssign: (signupId: number, selection?: { characterId?: string; role?: RosterRole }) => void;
    onRemove?: (signupId: number) => void;
    onSelfAssign?: () => void;
    availableSlots?: AvailableSlot[];
    onAssignToSlot?: (signupId: number, role: RosterRole, position: number, selection?: { characterId?: string }) => void;
    onGenerateInviteLink?: () => void;
    onRemoveFromEvent?: (signupId: number, username: string) => void;
    onReassignToSlot?: (fromSignupId: number, toRole: RosterRole, toPosition: number) => void;
    assigned?: RosterAssignmentResponse[];
    gameId?: number;
    isMMO?: boolean;
    currentUserId?: number;
    onSelfSlotClick?: (role: RosterRole, position: number) => void;
}

export interface SlotGroup {
    role: string;
    label: string;
    slots: AvailableSlot[];
}

import type { CharacterRole } from '@raid-ledger/contract';
import { RoleIcon } from '../shared/RoleIcon';

const ROLE_COLORS: Record<CharacterRole, string> = {
    tank: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    healer: 'bg-green-500/20 text-green-400 border-green-500/30',
    dps: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLES: CharacterRole[] = ['tank', 'healer', 'dps'];

interface RolePickerProps {
    selectedRoles: CharacterRole[];
    onToggleRole: (role: CharacterRole) => void;
    showMismatchWarning?: boolean;
    mismatchDefaultRole?: string | null;
    mismatchSelectedRole?: string | null;
}

export function RolePicker({ selectedRoles, onToggleRole, showMismatchWarning, mismatchDefaultRole, mismatchSelectedRole }: RolePickerProps) {
    return (
        <div>
            <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                Preferred Roles
                <span className="ml-1 text-muted font-normal normal-case">(select all you can play)</span>
            </h3>
            <div className="flex gap-2">
                {ROLES.map((role) => {
                    const isSelected = selectedRoles.includes(role);
                    return (
                        <button
                            key={role}
                            onClick={() => onToggleRole(role)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium ${
                                isSelected
                                    ? `${ROLE_COLORS[role]} border-current`
                                    : 'border-edge bg-panel/50 text-muted hover:border-edge-strong hover:bg-panel'
                            }`}
                        >
                            <RoleIcon role={role} size="w-5 h-5" />
                            <span>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
                        </button>
                    );
                })}
            </div>
            {selectedRoles.length > 1 && (
                <p className="text-xs text-emerald-400/80 mt-1.5">
                    You'll be auto-assigned to the best available slot.
                </p>
            )}
            {showMismatchWarning && mismatchDefaultRole && mismatchSelectedRole && selectedRoles.length === 1 && (
                <p className="text-xs text-amber-400/80 mt-1.5">
                    This character's default role is {mismatchDefaultRole}. Signing up as {mismatchSelectedRole} instead.
                </p>
            )}
        </div>
    );
}

export { ROLE_COLORS, ROLES };

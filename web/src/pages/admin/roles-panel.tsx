import { RoleManagementCard } from '../../components/admin/RoleManagementCard';

/**
 * General > Role Management panel.
 * ROK-281: Wraps existing RoleManagementCard in the admin sidebar layout.
 */
export function RolesPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">User Management</h2>
                <p className="text-sm text-muted mt-1">Assign roles and manage user permissions.</p>
            </div>
            <RoleManagementCard />
        </div>
    );
}

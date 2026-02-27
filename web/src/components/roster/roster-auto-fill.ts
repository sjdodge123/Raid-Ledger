import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';

export interface AutoFillResult {
    newPool: RosterAssignmentResponse[];
    newAssignments: RosterAssignmentResponse[];
    summary: { role: string; count: number }[];
    totalFilled: number;
}

/**
 * ROK-209: Pure function that computes auto-fill assignments.
 * MMO: role-match → flex overflow → backfill → bench overflow.
 * Generic: sequential fill by signup order.
 */
export function computeAutoFill(
    pool: RosterAssignmentResponse[],
    assignments: RosterAssignmentResponse[],
    roleSlots: { role: RosterRole; label: string }[],
    getSlotCount: (role: RosterRole) => number,
    isGenericGame: boolean,
): AutoFillResult {
    const remaining = [...pool];
    const newAssignments = [...assignments];
    const summary: { role: string; count: number }[] = [];

    const findNextEmptyPosition = (role: RosterRole): number | null => {
        const count = getSlotCount(role);
        for (let pos = 1; pos <= count; pos++) {
            if (!newAssignments.some(a => a.slot === role && a.position === pos)) {
                return pos;
            }
        }
        return null;
    };

    const assignPlayer = (player: RosterAssignmentResponse, role: RosterRole, position: number, isOverride: boolean) => {
        const idx = remaining.findIndex(p => p.signupId === player.signupId);
        if (idx === -1) return;
        remaining.splice(idx, 1);
        newAssignments.push({ ...player, slot: role, position, isOverride });
    };

    if (isGenericGame) {
        // Generic: fill player slots sequentially
        for (const { role } of roleSlots) {
            let filled = 0;
            let pos = findNextEmptyPosition(role);
            while (pos !== null && remaining.length > 0) {
                assignPlayer(remaining[0], role, pos, false);
                filled++;
                pos = findNextEmptyPosition(role);
            }
            if (filled > 0) {
                const slotDef = roleSlots.find(s => s.role === role);
                summary.push({ role: slotDef?.label ?? role, count: filled });
            }
        }
    } else {
        // MMO algorithm (5 passes) — ROK-452: now uses preferredRoles
        const mmoRoles: RosterRole[] = ['tank', 'healer', 'dps'];

        // ROK-539: Priority ordering for flex players — tank/healer before DPS
        const rolePriority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

        // Pass 0 (ROK-452): Preferred-role match — assign rigid players (1 preferred role) first,
        // then flexible players (2+ preferred roles) to maximize slot coverage
        const withPrefs = remaining.filter(p => p.preferredRoles && p.preferredRoles.length > 0);
        // Sort by rigidity: fewer preferred roles first (rigid players get priority)
        withPrefs.sort((a, b) => (a.preferredRoles?.length ?? 0) - (b.preferredRoles?.length ?? 0));

        for (const player of withPrefs) {
            if (!remaining.some(r => r.signupId === player.signupId)) continue;
            const sortedPrefs = [...(player.preferredRoles ?? [])].sort(
                (a, b) => (rolePriority[a] ?? 99) - (rolePriority[b] ?? 99),
            );
            for (const prefRole of sortedPrefs) {
                const pos = findNextEmptyPosition(prefRole as RosterRole);
                if (pos !== null) {
                    assignPlayer(player, prefRole as RosterRole, pos, player.character?.role !== prefRole);
                    const slotDef = roleSlots.find(s => s.role === prefRole);
                    const label = slotDef?.label ?? prefRole;
                    const existing = summary.find(s => s.role === label);
                    if (existing) existing.count++;
                    else summary.push({ role: label, count: 1 });
                    break;
                }
            }
        }

        // Pass 1: Role-match — assign remaining pool players whose character.role matches the slot role
        for (const role of mmoRoles) {
            let filled = 0;
            const matching = remaining.filter(p => p.character?.role === role);
            for (const player of matching) {
                const pos = findNextEmptyPosition(role);
                if (pos === null) break;
                assignPlayer(player, role, pos, false);
                filled++;
            }
            if (filled > 0) {
                const slotDef = roleSlots.find(s => s.role === role);
                const label = slotDef?.label ?? role;
                const existing = summary.find(s => s.role === label);
                if (existing) existing.count += filled;
                else summary.push({ role: label, count: filled });
            }
        }

        // Pass 2: Flex overflow — remaining unmatched players → empty flex slots
        if (getSlotCount('flex') > 0) {
            let filled = 0;
            let pos = findNextEmptyPosition('flex');
            while (pos !== null && remaining.length > 0) {
                assignPlayer(remaining[0], 'flex', pos, true);
                filled++;
                pos = findNextEmptyPosition('flex');
            }
            if (filled > 0) {
                summary.push({ role: 'Flex', count: filled });
            }
        }

        // Pass 3: Backfill — if role slots still empty and pool players remain, fill any role
        for (const role of mmoRoles) {
            let filled = 0;
            let pos = findNextEmptyPosition(role);
            while (pos !== null && remaining.length > 0) {
                assignPlayer(remaining[0], role, pos, true);
                filled++;
                pos = findNextEmptyPosition(role);
            }
            if (filled > 0) {
                const existing = summary.find(s => s.role === (roleSlots.find(r => r.role === role)?.label ?? role));
                if (existing) {
                    existing.count += filled;
                } else {
                    const slotDef = roleSlots.find(s => s.role === role);
                    summary.push({ role: slotDef?.label ?? role, count: filled });
                }
            }
        }

        // Pass 4: Bench overflow — fill bench slots with remaining players
        if (getSlotCount('bench') > 0) {
            let filled = 0;
            let pos = findNextEmptyPosition('bench');
            while (pos !== null && remaining.length > 0) {
                assignPlayer(remaining[0], 'bench', pos, true);
                filled++;
                pos = findNextEmptyPosition('bench');
            }
            if (filled > 0) {
                summary.push({ role: 'Bench', count: filled });
            }
        }
    }

    const totalFilled = pool.length - remaining.length;
    return { newPool: remaining, newAssignments, summary, totalFilled };
}

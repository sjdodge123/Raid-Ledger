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
interface FillContext {
    remaining: RosterAssignmentResponse[];
    newAssignments: RosterAssignmentResponse[];
    summary: { role: string; count: number }[];
    roleSlots: { role: RosterRole; label: string }[];
    getSlotCount: (role: RosterRole) => number;
}

function findNextEmpty(ctx: FillContext, role: RosterRole): number | null {
    const count = ctx.getSlotCount(role);
    for (let pos = 1; pos <= count; pos++) {
        if (!ctx.newAssignments.some(a => a.slot === role && a.position === pos)) return pos;
    }
    return null;
}

function assignPlayer(ctx: FillContext, player: RosterAssignmentResponse, role: RosterRole, position: number, isOverride: boolean) {
    const idx = ctx.remaining.findIndex(p => p.signupId === player.signupId);
    if (idx === -1) return;
    ctx.remaining.splice(idx, 1);
    ctx.newAssignments.push({ ...player, slot: role, position, isOverride });
}

function addToSummary(ctx: FillContext, role: RosterRole | string, filled: number) {
    const label = ctx.roleSlots.find(s => s.role === role)?.label ?? role;
    const existing = ctx.summary.find(s => s.role === label);
    if (existing) existing.count += filled;
    else ctx.summary.push({ role: label, count: filled });
}

function fillGeneric(ctx: FillContext) {
    for (const { role } of ctx.roleSlots) {
        let filled = 0;
        let pos = findNextEmpty(ctx, role);
        while (pos !== null && ctx.remaining.length > 0) {
            assignPlayer(ctx, ctx.remaining[0], role, pos, false);
            filled++;
            pos = findNextEmpty(ctx, role);
        }
        if (filled > 0) addToSummary(ctx, role, filled);
    }
}

function fillPreferredRoles(ctx: FillContext) {
    const rolePriority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
    const withPrefs = ctx.remaining.filter(p => p.preferredRoles && p.preferredRoles.length > 0);
    withPrefs.sort((a, b) => (a.preferredRoles?.length ?? 0) - (b.preferredRoles?.length ?? 0));

    for (const player of withPrefs) {
        if (!ctx.remaining.some(r => r.signupId === player.signupId)) continue;
        const sortedPrefs = [...(player.preferredRoles ?? [])].sort(
            (a, b) => (rolePriority[a] ?? 99) - (rolePriority[b] ?? 99),
        );
        for (const prefRole of sortedPrefs) {
            const pos = findNextEmpty(ctx, prefRole as RosterRole);
            if (pos !== null) {
                assignPlayer(ctx, player, prefRole as RosterRole, pos, player.character?.role !== prefRole);
                addToSummary(ctx, prefRole, 1);
                break;
            }
        }
    }
}

function fillRoleMatch(ctx: FillContext, roles: RosterRole[]) {
    for (const role of roles) {
        let filled = 0;
        const matching = ctx.remaining.filter(p => p.character?.role === role);
        for (const player of matching) {
            const pos = findNextEmpty(ctx, role);
            if (pos === null) break;
            assignPlayer(ctx, player, role, pos, false);
            filled++;
        }
        if (filled > 0) addToSummary(ctx, role, filled);
    }
}

function fillOverflow(ctx: FillContext, role: RosterRole, label: string) {
    if (ctx.getSlotCount(role) === 0) return;
    let filled = 0;
    let pos = findNextEmpty(ctx, role);
    while (pos !== null && ctx.remaining.length > 0) {
        assignPlayer(ctx, ctx.remaining[0], role, pos, true);
        filled++;
        pos = findNextEmpty(ctx, role);
    }
    if (filled > 0) ctx.summary.push({ role: label, count: filled });
}

function fillBackfill(ctx: FillContext, roles: RosterRole[]) {
    for (const role of roles) {
        let filled = 0;
        let pos = findNextEmpty(ctx, role);
        while (pos !== null && ctx.remaining.length > 0) {
            assignPlayer(ctx, ctx.remaining[0], role, pos, true);
            filled++;
            pos = findNextEmpty(ctx, role);
        }
        if (filled > 0) addToSummary(ctx, role, filled);
    }
}

export function computeAutoFill(
    pool: RosterAssignmentResponse[],
    assignments: RosterAssignmentResponse[],
    roleSlots: { role: RosterRole; label: string }[],
    getSlotCount: (role: RosterRole) => number,
    isGenericGame: boolean,
): AutoFillResult {
    const ctx: FillContext = {
        remaining: [...pool], newAssignments: [...assignments],
        summary: [], roleSlots, getSlotCount,
    };

    if (isGenericGame) {
        fillGeneric(ctx);
    } else {
        const mmoRoles: RosterRole[] = ['tank', 'healer', 'dps'];
        fillPreferredRoles(ctx);
        fillRoleMatch(ctx, mmoRoles);
        fillOverflow(ctx, 'flex', 'Flex');
        fillBackfill(ctx, mmoRoles);
        fillOverflow(ctx, 'bench', 'Bench');
    }

    return { newPool: ctx.remaining, newAssignments: ctx.newAssignments, summary: ctx.summary, totalFilled: pool.length - ctx.remaining.length };
}

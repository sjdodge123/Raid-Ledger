/** ROK-1893 P1 — pure helpers for the hub invite UI (expiry choices, live check, row copy). */
import type { CreateHubInviteDto, HubInvite } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';

export const EXPIRY_OPTIONS = [
    { value: '1', label: '1 hour' },
    { value: '24', label: '1 day' },
    { value: '168', label: '7 days' },
    { value: '720', label: '30 days' },
    { value: 'never', label: 'Never' },
] as const;
export type ExpiryChoice = (typeof EXPIRY_OPTIONS)[number]['value'];
export const DEFAULT_EXPIRY: ExpiryChoice = '168';

export function isExpiryChoice(v: string): v is ExpiryChoice {
    return EXPIRY_OPTIONS.some((o) => o.value === v);
}

export function createDto(choice: ExpiryChoice): CreateHubInviteDto {
    return { expiresInHours: choice === 'never' ? null : Number(choice) };
}

/** Not revoked, not expired, not used up. */
export function isLiveInvite(inv: HubInvite, now: number): boolean {
    if (inv.revokedAt !== null) return false;
    if (inv.expiresAt !== null && Date.parse(inv.expiresAt) <= now) return false;
    return inv.maxUses === null || inv.useCount < inv.maxUses;
}

export function expiryLabel(expiresAt: string | null, now: number): string {
    if (expiresAt === null) return 'Never expires';
    const hours = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 3_600_000));
    if (hours < 24) return `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    const days = Math.round(hours / 24);
    return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function usesLabel(inv: HubInvite): string {
    return inv.maxUses === null ? `${inv.useCount} joined` : `${inv.useCount} of ${inv.maxUses} joined`;
}

/** Live member of an active community hub ⇒ may make invite links (§8a(a)). */
export function canInvite(ctx: HubCtx): boolean {
    return ctx.page.community?.status === 'active' && ctx.page.viewer.role !== 'visitor';
}

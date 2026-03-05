import type { EventPlanResponseDto, EventPlanStatus, PollMode } from '@raid-ledger/contract';

export const STATUS_STYLES: Record<EventPlanStatus, { bg: string; text: string; label: string }> = {
    polling: { bg: 'bg-blue-500/15', text: 'text-blue-300', label: 'Polling' },
    completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Completed' },
    expired: { bg: 'bg-amber-500/15', text: 'text-amber-300', label: 'Expired' },
    cancelled: { bg: 'bg-red-500/15', text: 'text-red-300', label: 'Cancelled' },
    draft: { bg: 'bg-gray-500/15', text: 'text-gray-300', label: 'Draft' },
};

export const POLL_MODE_LABELS: Record<PollMode, string> = {
    standard: 'Standard',
    all_or_nothing: 'All or Nothing',
};

export function formatTimeRemaining(pollEndsAt: string | null): string | null {
    if (!pollEndsAt) return null;
    const now = Date.now();
    const end = new Date(pollEndsAt).getTime();
    const diff = end - now;
    if (diff <= 0) return 'Ended';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
}

export function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
}

export function formatSlotConfig(
    slotConfig: EventPlanResponseDto['slotConfig'],
): string | null {
    if (!slotConfig) return null;
    if (slotConfig.type === 'mmo') {
        const parts: string[] = [];
        if (slotConfig.tank) parts.push(`${slotConfig.tank} Tank`);
        if (slotConfig.healer) parts.push(`${slotConfig.healer} Healer`);
        if (slotConfig.dps) parts.push(`${slotConfig.dps} DPS`);
        if (slotConfig.flex) parts.push(`${slotConfig.flex} Flex`);
        if (slotConfig.bench) parts.push(`${slotConfig.bench} Bench`);
        return parts.join(' \u00B7 ');
    }
    if (slotConfig.type === 'generic') {
        const parts: string[] = [];
        if (slotConfig.player) parts.push(`${slotConfig.player} Players`);
        if (slotConfig.bench) parts.push(`${slotConfig.bench} Bench`);
        return parts.join(' \u00B7 ');
    }
    return null;
}

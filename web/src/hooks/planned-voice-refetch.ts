import type { VoiceChannelResponseDto } from '@raid-ledger/contract';

/** How long after `plannedOpensAt` the first refetch fires (the scheduler scans every minute). */
export const PLANNED_VOICE_GRACE_MS = 60_000;
/** Retry interval while the response is still planned after the first refetch. */
export const PLANNED_VOICE_RETRY_MS = 60_000;
/** Retries after the first refetch before giving up. */
export const PLANNED_VOICE_MAX_RETRIES = 10;
/** One timer at most this far out; keeps `setTimeout` well clear of its ~24.8-day overflow. */
export const PLANNED_VOICE_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * `refetchInterval` for the event-detail bundle while its voice channel is a
 * planned temporary one: refetch a little after it opens, then retry every
 * minute for a bounded window. `false` (no polling) once the channel is live,
 * absent, or the retry window has passed.
 */
export function plannedVoiceRefetchDelay(
    voiceChannel: VoiceChannelResponseDto | null | undefined,
    now: number,
): number | false {
    if (!voiceChannel || voiceChannel.channelId || !voiceChannel.plannedOpensAt) return false;
    const opensAt = Date.parse(voiceChannel.plannedOpensAt);
    if (Number.isNaN(opensAt)) return false;
    const firstRefetchAt = opensAt + PLANNED_VOICE_GRACE_MS;
    if (now < firstRefetchAt) return Math.min(firstRefetchAt - now, PLANNED_VOICE_MAX_DELAY_MS);
    const giveUpAt = firstRefetchAt + PLANNED_VOICE_RETRY_MS * PLANNED_VOICE_MAX_RETRIES;
    return now < giveUpAt ? PLANNED_VOICE_RETRY_MS : false;
}

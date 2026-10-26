/** ROK-1941 — pure copy helpers for the settings sheet's "Pictures" section. */
import type { HubMediaBackfillStatus, HubMediaBackfillSummary } from './hub-media-channel-api';
import type { HubMediaChannelState } from './hub-media-channel-api';

/** The Select's starting value: the bound channel, else the mirror suggestion (OQ2), else none. */
export function initialMediaChoice(state: HubMediaChannelState): string {
    return state.channelId ?? state.suggestedChannelId ?? '';
}

/** Comma-joined D12 counts, e.g. "Scanned 40 messages · 12 pictures stored · …". */
export function backfillCountsLine(s: HubMediaBackfillSummary): string {
    return [
        `Scanned ${s.scanned} messages`, `${s.imagesStored} pictures stored`, `${s.duplicates} duplicates`,
        `${s.deathsLinked} deaths linked`, `${s.deathsInferred} deaths inferred`, `${s.failed} failed`,
    ].join(' · ');
}

/** The status line under the scan button; null before any run. */
export function backfillStatusLine(status: HubMediaBackfillStatus): string | null {
    const counts = status.summary ? backfillCountsLine(status.summary) : null;
    if (status.state === 'running') return counts ? `Scanning… ${counts}` : 'Scanning…';
    if (status.state === 'done') return counts ? `Finished. ${counts}` : 'Finished.';
    if (status.state === 'failed') return counts ? `The scan stopped early. ${counts}` : 'The scan stopped early.';
    return null;
}

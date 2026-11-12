/**
 * ROK-2187 — turn the send-now response (`GgDeliveryOutcome` in
 * `api/src/plugins/core/gg/gg-delivery.service.ts`, HTTP 200 for every
 * status) into the toast the admin sees. Paused is a 409 and arrives as an error.
 */
import type { GgSendNowOutcome } from '../../../lib/api/gg-admin-api';

export type { GgSendNowOutcome };

/** Which toast to show and what it says. */
export interface GgSendNowToast {
    kind: 'success' | 'info' | 'error';
    text: string;
}

/** An announcement older than this before the click was already out. */
const ALREADY_ANNOUNCED_SLACK_MS = 2 * 60_000;

const NO_OP: Record<string, string> = {
    disabled: 'Nothing sent — GG delivery is turned off. Turn it on in the delivery settings first.',
    'not-connected': "Nothing sent — the Discord bot isn't connected. Reconnect it and try again.",
    'no-channel': 'Nothing sent — there is no announcement channel. Pick one in the delivery settings or set the bot\'s default channel.',
    busy: 'Nothing sent — a delivery pass is already running. Try again in a minute.',
};

/** Map one send-now outcome to a toast; anything unrecognised is never shown as success. */
export function ggSendNowToast(outcome: GgSendNowOutcome, clickedAt: Date): GgSendNowToast {
    const reason = NO_OP[outcome.status];
    if (reason) return { kind: 'error', text: reason };
    if ((outcome.status !== 'announced' && outcome.status !== 'waiting-offset') || !outcome.announcedAt) {
        return { kind: 'error', text: `Nothing sent (${outcome.status}).` };
    }
    const at = new Date(outcome.announcedAt);
    const year = outcome.year ?? at.getFullYear();
    if (at.getTime() < clickedAt.getTime() - ALREADY_ANNOUNCED_SLACK_MS) {
        return { kind: 'info', text: `GG ${year} was already announced on ${at.toLocaleString()} — nothing new was posted.` };
    }
    return { kind: 'success', text: `GG ${year} announced. Players get their DMs on the regular 5-minute runs.` };
}

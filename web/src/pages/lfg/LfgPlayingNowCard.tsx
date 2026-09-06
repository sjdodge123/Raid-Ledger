/**
 * ROK-1494 AC3 — the group page's live-session state.
 *
 * When a `now` group spawns its ad-hoc event the intents are CONVERTED, so
 * `activeCount` drops to 0 and every count-driven surface would read as an
 * empty group (D9). `playingNow` is the only signal that the group is
 * mid-session, and this card is what it renders: where the session is, and the
 * two ways in — the Discord voice channel and the event page.
 *
 * No timer and no countdown: a session has no expiry, unlike the `now` intents
 * that produced it.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgPlayingNowDto } from '@raid-ledger/contract';
import { LFG_COPY, playingNowCount } from './lfg-copy';

export interface LfgPlayingNowCardProps {
    /** `LfgGroupDetailDto.playingNow` — null unless a session is open. */
    playingNow: LfgPlayingNowDto | null;
}

const LINK_BTN =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white';
const SECONDARY_LINK =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-overlay hover:bg-faint text-foreground';

/** The two ways into a live session; the voice anchor only once it exists. */
function SessionLinks({
    playingNow,
}: {
    playingNow: LfgPlayingNowDto;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {playingNow.voiceInviteUrl != null ? (
                <a
                    data-testid="lfg-playing-now-voice"
                    href={playingNow.voiceInviteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={LINK_BTN}
                >
                    {LFG_COPY.playingNowJoinVoice}
                </a>
            ) : null}
            <Link
                data-testid="lfg-playing-now-event"
                to={`/events/${playingNow.eventId}`}
                className={SECONDARY_LINK}
            >
                {LFG_COPY.playingNowOpenEvent}
            </Link>
        </div>
    );
}

/**
 * The playing-now card, or nothing at all.
 *
 * `voiceInviteUrl` is read defensively: the temp voice channel is created
 * AFTER the spawn transaction commits, so a read landing in that window
 * carries an event with no channel yet. The card still renders — the event
 * link alone is a usable way in — and grows the voice link on the next fetch.
 *
 * @param props.playingNow - The live session, or null when there is none.
 */
export function LfgPlayingNowCard({
    playingNow,
}: LfgPlayingNowCardProps): JSX.Element | null {
    if (playingNow == null) return null;
    return (
        <div
            data-testid="lfg-playing-now"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
            <p className="text-sm font-semibold text-emerald-300">
                <span data-testid="lfg-playing-now-title">
                    {LFG_COPY.playingNowTitle}
                </span>
                {' · '}
                <span data-testid="lfg-playing-now-count">
                    {playingNowCount(playingNow.participantCount)}
                </span>
            </p>
            <SessionLinks playingNow={playingNow} />
        </div>
    );
}

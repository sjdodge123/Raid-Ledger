/** The always-visible GG sound toggle in the story header (ROK-2187). */
import type { JSX } from 'react';
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/button';
import type { GgAudio } from './use-gg-audio';

/** Mute / unmute the mascot sound and the GG theme (persisted). */
export function GgMuteToggle({ audio }: { audio: GgAudio }): JSX.Element {
    const Icon = audio.muted ? SpeakerXMarkIcon : SpeakerWaveIcon;
    return (
        <Button variant="ghost" size="sm" iconOnly aria-label={audio.muted ? 'Unmute GG sound' : 'Mute GG sound'}
            aria-pressed={audio.muted} onClick={audio.toggleMute}>
            <Icon aria-hidden="true" className="h-5 w-5" />
        </Button>
    );
}

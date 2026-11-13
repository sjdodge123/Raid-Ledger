/** ROK-2187 — closing the story while a trailer holds the music must not restart it. */
import { useEffect, useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useGgAudio, type GgAudio } from './use-gg-audio';
import type { GgTrack } from './gg-music';

const TRACKS: readonly GgTrack[] = [{ id: 't', title: 'T', url: '/gg/music/t.mp3', licence: 'CC0', credit: null }];

/** Mirrors the trailer: holds the music while mounted, releases it on unmount. */
function Trailer({ audio }: { audio: GgAudio }): null {
    useEffect(() => { audio.pauseMusic(); return () => audio.resumeMusic(); }, [audio]);
    return null;
}

function Story(): JSX.Element {
    const audio = useGgAudio(TRACKS);
    const [trailer, setTrailer] = useState(false);
    return (
        <>
            <button onClick={() => audio.start()}>start</button>
            <button onClick={() => setTrailer(true)}>trailer</button>
            {trailer && <Trailer audio={audio} />}
        </>
    );
}

describe('useGgAudio — close during a trailer (ROK-2187)', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('unmounting the story while a trailer holds the music never plays it again', () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const { unmount } = render(<Story />);
        fireEvent.click(screen.getByText('start'));
        expect(play).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByText('trailer'));
        play.mockClear();
        unmount();
        expect(play, 'music restarted after the story closed').not.toHaveBeenCalled();
    });
});

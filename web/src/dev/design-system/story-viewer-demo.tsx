/**
 * /dev/design-system — StoryViewer demo (§4.34, ROK-2187). Synthetic slides,
 * tokens only. Lazy-loaded by story-viewer-section.tsx.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { StoryViewer, KenBurnsBackground, type StorySlide } from '../../components/ui/story-viewer';
import { useStoryControls } from '../../components/ui/story-controls';

function BigStat({ value, label }: { value: string; label: string }): JSX.Element {
    return (
        <div className="mt-auto">
            <p className="text-6xl font-bold text-foreground">{value}</p>
            <p className="text-lg text-secondary">{label}</p>
        </div>
    );
}

/** Stands in for a trailer card: pauses auto-advance while "playing". */
function FakeTrailer(): JSX.Element {
    const { paused, pause, resume } = useStoryControls();
    return (
        <div className="mt-auto flex flex-col gap-3">
            <BigStat value="Trailer" label="12 s on this card; the button pauses the story through useStoryControls()." />
            <Button variant="secondary" onClick={paused ? resume : pause}>{paused ? 'Stop trailer' : 'Play trailer'}</Button>
        </div>
    );
}

const SLIDES: StorySlide[] = [
    {
        id: 'intro', label: 'Intro',
        content: <BigStat value="GG 2026" label="Moves on every 7 s. Hold to pause, Space or ⏸ toggles; tap right (or →) / left to page." />,
    },
    {
        id: 'events', label: 'Events',
        background: <KenBurnsBackground src="/game-covers/chao-chao-cover.jpg" />,
        content: <BigStat value="47" label="events — Ken Burns screenshot behind (static under reduced motion)" />,
    },
    {
        id: 'gradient', label: 'Fallback background',
        background: <KenBurnsBackground />,
        content: () => <BigStat value="380h" label="no screenshot — the token gradient fallback" />,
    },
    { id: 'trailer', label: 'Trailer', durationMs: 12_000, content: <FakeTrailer /> },
    {
        id: 'summary', label: 'Summary',
        content: (
            <div className="mt-auto flex flex-col gap-3">
                <BigStat value="That's a wrap" label="A control on a slide stays pressable; empty space still pages." />
                <Button variant="primary">Share</Button>
            </div>
        ),
    },
];

/** Opens the StoryViewer over the page; Esc or × closes it. */
export default function StoryViewerDemo(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <div className="flex flex-col items-start gap-2">
            <Button variant="secondary" onClick={() => setOpen(true)}>Open the story viewer</Button>
            <p className="text-xs text-muted">Phone below 1024px (full screen); a centred 9:16 card with side arrows from 1024px. Reduced motion = no auto-advance.</p>
            {open && <StoryViewer title="GG 2026" slides={SLIDES} onClose={() => setOpen(false)} />}
        </div>
    );
}

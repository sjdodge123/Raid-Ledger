/**
 * ROK-2187 L10 — the "From Discord" half of the GG mascot picker: the guild's
 * custom emojis as a pressed-tile grid and its soundboard sounds as a list
 * with a ▶ preview. Unavailable sounds (the guild lost the boost) are disabled.
 */
import type { JSX } from 'react';
import { PlayIcon } from '@heroicons/react/24/solid';
import type { GgMascotOptionsDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { toast } from '../../../lib/toast';
import { fetchGgSoundPreviewUrl } from '../../../lib/api/gg-admin-api';

type Emoji = GgMascotOptionsDto['emojis'][number];
type Sound = GgMascotOptionsDto['sounds'][number];

const PRESSED = 'aria-pressed:ring-2 aria-pressed:ring-success/80 aria-pressed:border-success';

/** Plays a sound through the admin-only preview stream (same-origin blob). */
async function playPreview(id: string): Promise<void> {
    try {
        const url = await fetchGgSoundPreviewUrl(id);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not play the preview');
    }
}

/** Emoji grid — one pressed tile per custom emoji. */
export function GgMascotEmojiGrid({ emojis, value, onChange }: {
    emojis: Emoji[]; value: string | null; onChange: (id: string) => void;
}): JSX.Element {
    if (emojis.length === 0) return <p className="text-sm text-muted">Your Discord server has no custom emojis.</p>;
    return (
        <div role="group" aria-label="Pick an emoji" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {emojis.map((e) => (
                <Button key={e.id} variant="secondary" aria-pressed={value === e.id} data-testid={`gg-mascot-emoji-${e.id}`}
                    className={`justify-start gap-2 ${PRESSED}`} onClick={() => onChange(e.id)}>
                    <img src={e.previewUrl} alt="" className="w-7 h-7 object-contain" loading="lazy" />
                    <span className="truncate">:{e.name}:</span>
                    {e.animated && <span className="text-xs text-dim">animated</span>}
                </Button>
            ))}
        </div>
    );
}

function SoundRow({ sound, selected, onSelect }: { sound: Sound; selected: boolean; onSelect: () => void }): JSX.Element {
    const meta = sound.available ? `vol ${Math.round(sound.volume * 100)}%` : 'unavailable — server lost boosts';
    return (
        <li className="flex items-center gap-2">
            <Button iconOnly variant="ghost" aria-label={`Preview ${sound.name}`} disabled={!sound.available}
                data-testid={`gg-mascot-sound-preview-${sound.id}`} onClick={() => void playPreview(sound.id)}>
                <PlayIcon className="w-4 h-4" aria-hidden />
            </Button>
            <Button variant="secondary" aria-pressed={selected} disabled={!sound.available} data-testid={`gg-mascot-sound-${sound.id}`}
                className={`flex-1 justify-between ${PRESSED}`} onClick={onSelect}>
                <span className="truncate">{sound.name}</span>
                <span className="text-xs text-muted">{selected ? '✓ selected' : meta}</span>
            </Button>
        </li>
    );
}

/** Sound list — "No sound" plus every soundboard sound. */
export function GgMascotSoundList({ sounds, value, onChange }: {
    sounds: Sound[]; value: string | null; onChange: (id: string | null) => void;
}): JSX.Element {
    return (
        <ul aria-label="Pick a soundboard sound" className="space-y-2">
            <li>
                <Button variant="secondary" aria-pressed={value === null} data-testid="gg-mascot-sound-none"
                    className={`w-full justify-start ${PRESSED}`} onClick={() => onChange(null)}>No sound</Button>
            </li>
            {sounds.map((s) => (
                <SoundRow key={s.id} sound={s} selected={value === s.id} onSelect={() => onChange(s.id)} />
            ))}
        </ul>
    );
}

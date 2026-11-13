/**
 * ROK-2187 L10 — Admin → GG → "GG mascot": None / From Discord. Saving copies
 * the emoji + sound into Raid Ledger's storage; Re-sync re-copies after an
 * edit in Discord; Remove deletes the copies. Bot offline ⇒ said so, the
 * saved selection still shows.
 */
import type { JSX } from 'react';
import { useState } from 'react';
import type { GgMascot, GgMascotSelectDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { RadioGroup } from '../../../components/ui/radio-group';
import { useGgMascot, useGgMascotOptions, useSelectGgMascot } from '../../../hooks/admin/use-gg-admin';
import { httpStatusOf } from '../../../lib/api/api-error';
import { resolveGgAssetUrl } from '../../../lib/api/gg-api';
import { toast } from '../../../lib/toast';
import { GgMascotEmojiGrid, GgMascotSoundList } from './gg-mascot-options';

type Source = 'none' | 'discord';
const SOURCES = [{ value: 'none', label: 'None' }, { value: 'discord', label: 'From Discord' }] as const;

function CurrentMascot({ mascot }: { mascot: GgMascot | null }): JSX.Element {
    if (!mascot) return <p data-testid="gg-mascot-current" className="text-sm text-muted">No mascot — the plain intro shows.</p>;
    return (
        <div data-testid="gg-mascot-current" className="flex items-center gap-3 text-sm text-foreground">
            <img src={resolveGgAssetUrl(mascot.imageUrl)} alt="" className="w-10 h-10 object-contain" />
            <span>Saved: <b>:{mascot.emojiName}:</b>{mascot.soundName ? ` with “${mascot.soundName}”` : ' (no sound)'}</span>
        </div>
    );
}

function OptionsPicker({ draft, setDraft }: {
    draft: GgMascotSelectDto; setDraft: (d: GgMascotSelectDto) => void;
}): JSX.Element {
    const options = useGgMascotOptions(true);
    if (options.isLoading) return <p className="text-sm text-muted">Loading your Discord server…</p>;
    if (options.isError) {
        const offline = httpStatusOf(options.error) === 503;
        return (
            <p data-testid={offline ? 'gg-mascot-bot-offline' : 'gg-mascot-options-error'} role="status" className="text-sm text-warning">
                {offline ? 'The Discord bot is offline — connect it to pick a mascot.' : options.error.message}
            </p>
        );
    }
    const data = options.data ?? { emojis: [], sounds: [] };
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted">Emoji · {data.emojis.length} custom emojis on your server</h4>
            <GgMascotEmojiGrid emojis={data.emojis} value={draft.emojiId} onChange={(emojiId) => setDraft({ ...draft, emojiId })} />
            <h4 className="text-sm font-medium text-muted">Sound · from your soundboard (MP3/Ogg, ≤5.2 s)</h4>
            <GgMascotSoundList sounds={data.sounds} value={draft.soundId} onChange={(soundId) => setDraft({ ...draft, soundId })} />
            <p className="text-xs text-dim">Preview plays through Raid Ledger. Ogg sounds may not play on iPhone.</p>
        </div>
    );
}

function Editor({ saved }: { saved: GgMascot | null }): JSX.Element {
    const [source, setSource] = useState<Source>(saved ? 'discord' : 'none');
    const [draft, setDraft] = useState<GgMascotSelectDto>({ emojiId: saved?.emojiId ?? null, soundId: saved?.soundId ?? null });
    const select = useSelectGgMascot();
    const run = (body: GgMascotSelectDto, done: string): void => select.mutate(body, {
        onSuccess: () => toast.success(done),
        onError: (err) => toast.error(err.message),
    });
    return (
        <div className="space-y-4">
            <CurrentMascot mascot={saved} />
            <RadioGroup label="GG mascot source" hideLabel appearance="segmented" options={SOURCES} value={source} onChange={setSource} />
            {source === 'discord' && <OptionsPicker draft={draft} setDraft={setDraft} />}
            <div className="flex flex-wrap gap-2">
                {source === 'discord' && (
                    <Button data-testid="gg-mascot-save" disabled={!draft.emojiId} loading={select.isPending}
                        onClick={() => run(draft, 'Mascot saved')}>Save mascot</Button>
                )}
                {saved && (
                    <Button variant="secondary" data-testid="gg-mascot-resync" disabled={select.isPending}
                        onClick={() => run({ emojiId: saved.emojiId, soundId: saved.soundId }, 'Mascot re-synced')}>Re-sync from Discord</Button>
                )}
                {saved && (
                    <Button variant="destructive-soft" data-testid="gg-mascot-remove" disabled={select.isPending}
                        onClick={() => run({ emojiId: null, soundId: null }, 'Mascot removed')}>Remove mascot</Button>
                )}
            </div>
        </div>
    );
}

/** The "GG mascot" section of the admin GG panel. */
export function GgMascotSection(): JSX.Element {
    const mascot = useGgMascot();
    return (
        <section data-testid="gg-mascot-section" className="bg-panel border border-edge rounded-lg p-4 space-y-3">
            <div>
                <h3 className="text-base font-semibold text-foreground">GG mascot</h3>
                <p className="text-sm text-muted">Shown on the GG intro; its sound plays when a player taps “Tap to start”. Saving copies both into Raid Ledger, so later changes in Discord never break a delivered GG.</p>
            </div>
            {mascot.isLoading ? <p className="text-sm text-muted">Loading…</p> : <Editor saved={mascot.data ?? null} />}
        </section>
    );
}

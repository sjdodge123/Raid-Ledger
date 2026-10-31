/**
 * Guild crest for /dev/design-system (ROK-1814, design-system §2.2 crest
 * exception + §3.2 `HubCrest`). Mounts the REAL `HubCrest` in its three
 * states — an uploaded image, a preset emblem (contract palette hex, the one
 * sanctioned fixed colour), and the token-only fallback — at every size, then
 * every curated emblem. Flip "Side by side" to check both colour families:
 * the frame and fallbacks repaint, the preset colours do not.
 */
import type { JSX } from 'react';
import {
    GUILD_CREST_EMBLEM_CREDIT_LINE,
    GUILD_CREST_EMBLEM_IDS,
    GUILD_CREST_PALETTE_IDS,
    type GuildCrest,
} from '@raid-ledger/contract';
import { HubCrest, type HubCrestSize } from '../../components/hub/crest/hub-crest';
import { Section, StateFrame } from './design-system-bits';

const SIZES: readonly HubCrestSize[] = ['sm', 'md', 'lg', 'hero'];
const NAME = 'Order of the Ember';

/** A same-origin image so the demo's "upload" renders without an API. */
function uploadCrest(): GuildCrest {
    const url = `${window.location.origin}/favicon-192.png`;
    return { source: 'upload', urlSm: url, urlLg: url };
}

const PRESET: GuildCrest = { source: 'preset', emblemId: 'dragon-head', fg: 'or', bg: 'gules' };

function SizeRow({ size }: { size: HubCrestSize }): JSX.Element {
    return (
        <div className="flex items-center gap-4" data-testid={`ds-crest-size-${size}`}>
            <span className="w-10 text-xs text-muted">{size}</span>
            <HubCrest crest={uploadCrest()} name={NAME} size={size} />
            <HubCrest crest={PRESET} name={NAME} size={size} />
            <HubCrest crest={null} name={NAME} size={size} />
        </div>
    );
}

/** Cycle fg/bg through the palette so the grid also shows the colour range. */
function emblemPreset(index: number): GuildCrest {
    const ids = GUILD_CREST_PALETTE_IDS;
    const fg = ids[index % ids.length] ?? 'or';
    const bg = ids[(index + 5) % ids.length] ?? 'sable';
    const emblemId = GUILD_CREST_EMBLEM_IDS[index] ?? 'checked-shield';
    return { source: 'preset', emblemId, fg, bg };
}

function EmblemGrid(): JSX.Element {
    return (
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-8" data-testid="ds-crest-emblems">
            {GUILD_CREST_EMBLEM_IDS.map((id, i) => (
                <li key={id} className="flex flex-col items-center gap-1 text-center text-xs text-muted">
                    <HubCrest crest={emblemPreset(i)} name={NAME} size="lg" />
                    <span className="break-all">{id}</span>
                </li>
            ))}
        </ul>
    );
}

/** The crest row: sizes × states, then the curated emblem set and its credit line. */
export function CrestSection(): JSX.Element {
    return (
        <Section id="crest" title="Guild crest — HubCrest"
            blurb="§3.2 HubCrest — upload (img), preset (emblem + palette, the §2.2 crest-data exception) and fallback (initials on the hero, shield in lists), 24 / 40 / 48 / 64→80px. The frame and fallbacks are tokens.">
            <div className="grid gap-4" data-testid="ds-crest">
                <StateFrame label="Sizes — upload · preset · fallback" note="hub-crest.tsx; a broken upload URL falls back the same way.">
                    <div className="grid gap-3">{SIZES.map((s) => <SizeRow key={s} size={s} />)}</div>
                </StateFrame>
                <StateFrame label="Preset emblems — game-icons.net" note="crest-emblem-art-a/b.ts; credits in docs/credits/game-icons.md.">
                    <div className="grid gap-3">
                        <EmblemGrid />
                        <p className="text-xs text-muted">{GUILD_CREST_EMBLEM_CREDIT_LINE}</p>
                    </div>
                </StateFrame>
            </div>
        </Section>
    );
}

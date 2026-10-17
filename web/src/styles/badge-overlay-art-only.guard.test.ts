import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { stripComments as stripCodeComments } from '../test/form-primitives-count';

/**
 * `.badge-overlay` placement guard (ROK-1472).
 *
 * `.badge-overlay` pins a badge's dark-theme colours in every light scheme, because a
 * badge drawn over cover art sits on the (dark) image, not on the themed surface. Off the
 * art it undoes the light repaint: the mobile event card's "Game Time" chip kept cyan-300
 * `#67e8f9` on its own light cyan tint (~1.2:1), and CI's light-contrast smoke failed on
 * /events at phone width. So `badge-overlay` is allowed only in components that draw over
 * cover art — a new user must be one, reviewed and added to `ART_OVERLAY_FILES`.
 *
 * Comments are stripped first, so prose naming the class can neither satisfy nor trip it.
 */

const SRC = resolve(__dirname, '..');

/** Components whose `badge-overlay` badges sit on cover art (paths under `web/src`). */
const ART_OVERLAY_FILES = ['components/events/event-card.tsx'];

const BADGE_OVERLAY = /(?<![\w-])badge-overlay(?![\w-])/;

/** Shipped markup that uses the class — `web/src` minus `dev/` and test files. */
function badgeOverlayFiles(): string[] {
    return (readdirSync(SRC, { recursive: true }) as string[])
        .map((f) => f.split(sep).join('/'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith('dev/'))
        .filter((f) => BADGE_OVERLAY.test(stripCodeComments(readFileSync(join(SRC, f), 'utf-8'))))
        .sort();
}

describe('badge-overlay is only used on cover art (ROK-1472)', () => {
    it('no component off the art opts its badges out of the light repaint', () => {
        expect(badgeOverlayFiles()).toEqual(ART_OVERLAY_FILES);
    });
});

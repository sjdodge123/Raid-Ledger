/**
 * Share controls on the GG Summary card (ROK-2187, Q5): off until the player
 * opts in for this year. On → the public link (copy) and a preview of the
 * server-rendered share image. Off → the link and image 404 at once.
 */
import type { JSX } from 'react';
import { Switch } from '../ui/switch';
import { CopyButton } from '../ui/CopyButton';
import { useSetGgShare } from '../../hooks/use-gg';
import { ggPublicPageUrl, ggShareImageUrl } from '../../lib/api/gg-api';
import { useGgStory } from './gg-story-context';

/** The toggle + link + image preview for the story's year. */
export function GgSharePanel(): JSX.Element {
    const { year, share } = useGgStory();
    const toggle = useSetGgShare(year);
    const slug = share.shared ? share.slug : null;
    return (
        <div className="w-full rounded-xl border border-edge bg-panel/80 p-3">
            <div className="flex items-center justify-between gap-3">
                <span id="gg-share-label" className="text-sm font-medium text-foreground">Share my GG {year}</span>
                <Switch checked={share.shared} onChange={(on) => toggle.mutate(on)} disabled={toggle.isPending}
                    label={`Share my GG ${year} publicly`} aria-describedby="gg-share-help" />
            </div>
            <p id="gg-share-help" className="mt-1 text-xs text-muted">
                {slug ? 'Anyone with the link sees your summary — never anyone else’s name.' : 'Off — only you can see your GG.'}
            </p>
            {slug && (
                <div className="mt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-secondary" data-testid="gg-share-url">{ggPublicPageUrl(slug)}</span>
                        <CopyButton text={ggPublicPageUrl(slug)} label="Copy link" />
                    </div>
                    <img src={ggShareImageUrl(slug)} alt={`Share card preview for GG ${year}`}
                        className="aspect-[1200/630] w-full rounded-lg border border-edge object-cover" />
                </div>
            )}
        </div>
    );
}

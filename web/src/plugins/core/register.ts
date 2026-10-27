/**
 * ROK-1969 D2 — the built-in Core plugin. It owns every hub widget, tab and
 * behaviour shared by all hubs (declared under `core` in `HUB_PLUGIN_MANIFESTS`),
 * so nothing on a hub is unowned. It is always active (D3, `isSlugActive`) and
 * is imported before the game plugins in `App.tsx`.
 *
 * The core band (gm-post, discord, schedule, events, attendance) keeps its bare
 * ids and is built in `components/hub/layout/hub-widget-catalog.tsx` (D4); only
 * shared cards with a `plugin:core:<id>` key register here.
 */
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { registerPlugin } from '../plugin-registry';
import { LazyHubGalleryWidget } from '../../components/hub/gallery/hub-gallery-widget-lazy';
import { HubGallerySeeAll } from '../../components/hub/gallery/hub-gallery-see-all';
import { useGalleryWidgetVisible } from '../../components/hub/gallery/use-hub-gallery-visible';
import { LazyHubSessionNoteWidget } from '../../components/hub/session-note/hub-session-note-widget-lazy';
import { HubSessionNoteAction } from '../../components/hub/session-note/hub-session-note-action';
import { useSessionNoteVisible } from '../../components/hub/session-note/use-session-note-visible';

/** Core plugin (ROK-1969, OQ1) — label "Core" matches the arrange-mode owner label; neutral registry colour. */
const core = registerPlugin(CORE_PLUGIN_ID, {
    icon: '◆',
    color: '#64748B',
    label: 'Core',
});

// ROK-1942 D10 — the shared Gallery card (pictures from the hub's Discord), right after Deaths;
// members + staff (the route 404s visitors, D7). Members never see it empty (D12); editors get a hint.
// Moved from the Valheim plugin by ROK-1969 D6 (saved `plugin:valheim:gallery` ids alias to this one).
// Still Valheim server hubs only — widening it to every game is ROK-1965's call.
core.registerHubWidget({
    id: 'gallery',
    title: 'Gallery',
    description: 'Recent pictures from this hub — death posts and screenshots.',
    games: ['valheim'],
    kinds: ['game_server'],
    order: 47,
    span: 2,
    audience: 'members',
    defaultOn: true,
    component: LazyHubGalleryWidget,
    action: HubGallerySeeAll,
    useVisible: useGalleryWidgetVisible,
});

// ROK-1968 D9 — "Before next session": one shared note + checklist per hub, on every game and kind
// (`games`/`kinds` omitted — core only), right after the Leader post. Members read + tick; the route
// 404s visitors (ruling 3). Members never see it empty; editors get the "Add a note" hint.
core.registerHubWidget({
    id: 'session-note',
    title: 'Before next session',
    description: 'A shared note and checklist for the next session.',
    order: 15,
    span: 1,
    audience: 'members',
    defaultOn: true,
    component: LazyHubSessionNoteWidget,
    action: HubSessionNoteAction,
    useVisible: useSessionNoteVisible,
});

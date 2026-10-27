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

/** Core plugin (ROK-1969, OQ1) — label "Core" matches the arrange-mode owner label; neutral registry colour. */
const core = registerPlugin(CORE_PLUGIN_ID, {
    icon: '◆',
    color: '#64748B',
    label: 'Core',
});

// ROK-1942 D10 — the shared Gallery card, right after Deaths; members + staff (the route 404s
// visitors, D7). Moved from the Valheim plugin by ROK-1969 D6 (saved `plugin:valheim:gallery` ids
// alias to this one). ROK-1965 D14/OQ1: members can upload, so every hub has a source — no `games`
// or `kinds` (every hub kind and game, core may omit them); members see the empty card (D15).
core.registerHubWidget({
    id: 'gallery',
    title: 'Gallery',
    description: 'Pictures from this hub — Discord posts and member uploads.',
    order: 47,
    span: 2,
    audience: 'members',
    defaultOn: true,
    component: LazyHubGalleryWidget,
    action: HubGallerySeeAll,
    useVisible: useGalleryWidgetVisible,
});

/**
 * Test harness (ROK-1733): core character forms read plugin-owned identity
 * providers through `useCharacterIdentity`, so a test that exercises the WoW
 * identity on a core form must register the WoW plugin and mark it active —
 * the app does both at boot (`App.tsx` side-effect import + plugin hydration).
 */
import '../plugins/wow/register';
import { usePluginStore } from '../stores/plugin-store';

export function activateWowPlugin(): void {
    // `initialized` mirrors boot: the app has fetched /system/status and applied
    // its plugin list, which is what gates the hub's first render (ROK-1830).
    usePluginStore.setState({ activeSlugs: new Set(['blizzard']), initialized: true });
}

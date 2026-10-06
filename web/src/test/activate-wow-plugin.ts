/**
 * Test harness (ROK-1733): core character forms read plugin-owned identity
 * providers through `useCharacterIdentity`, so a test that exercises the WoW
 * identity on a core form must register the WoW plugin and mark it active —
 * the app does both at boot (`App.tsx` side-effect import + plugin hydration).
 */
import '../plugins/wow/register';
import { usePluginStore } from '../stores/plugin-store';

export function activateWowPlugin(): void {
    usePluginStore.setState({ activeSlugs: new Set(['blizzard']) });
}

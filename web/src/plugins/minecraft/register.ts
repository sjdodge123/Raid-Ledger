/**
 * ROK-2234 — the Minecraft web plugin (PLAN-minecraft-hub §5 S1). The slug
 * matches the api manifest id `minecraft`; it owns both edition game slugs
 * (`HUB_PLUGIN_MANIFESTS.minecraft`). No widgets or tabs yet — later stories
 * register them here and declare each one in the manifest (ROK-1969 guards).
 */
import { MINECRAFT_PLUGIN_ID } from '@raid-ledger/contract';
import { registerPlugin } from '../plugin-registry';

/** Neutral registry colour, like Valheim and BG3. */
registerPlugin(MINECRAFT_PLUGIN_ID, {
    icon: '⛏️',
    color: '#64748B',
    label: 'Minecraft',
});

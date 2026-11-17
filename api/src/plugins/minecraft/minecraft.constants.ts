/**
 * ROK-2234 — the Minecraft plugin's ids. The values live in
 * `@raid-ledger/contract` (`minecraft-hub.constants.ts`) so web and api share
 * one edition helper; re-exported here under the plugin-folder convention.
 */
export {
  MINECRAFT_PLUGIN_ID,
  MINECRAFT_JAVA_GAME_SLUG,
  MINECRAFT_BEDROCK_GAME_SLUG,
  MINECRAFT_BEDROCK_GAME_NAME,
  MINECRAFT_GAME_SLUGS,
  editionOf,
} from '@raid-ledger/contract';

// ============================================================
// ROK-2234 — the `minecraft` plugin's identity: its slug, the two game
// slugs it owns, and the edition helper. One plugin, two game rows; the
// edition of a hub is the edition of the Pelican server bound to it
// (PLAN-minecraft-hub §3), so the game slug is the only edition signal.
// ============================================================

/** Plugin slug (api manifest id, `HUB_PLUGIN_MANIFESTS` key). */
export const MINECRAFT_PLUGIN_ID = 'minecraft' as const;
/** `games.slug` of Minecraft: Java Edition — the IGDB-seeded row (IGDB 121). */
export const MINECRAFT_JAVA_GAME_SLUG = 'minecraft-java-edition' as const;
/** `games.slug` of Minecraft: Bedrock Edition — seeded + ensured by the plugin. */
export const MINECRAFT_BEDROCK_GAME_SLUG = 'minecraft-bedrock-edition' as const;
/** Display name of the Bedrock row (normalizes to 3 tokens, never "Minecraft"). */
export const MINECRAFT_BEDROCK_GAME_NAME = 'Minecraft: Bedrock Edition' as const;
/** Every `games.slug` the plugin owns, Java first. */
export const MINECRAFT_GAME_SLUGS = [
    MINECRAFT_JAVA_GAME_SLUG,
    MINECRAFT_BEDROCK_GAME_SLUG,
] as const;

export type MinecraftEdition = 'java' | 'bedrock';

/** The edition a game slug stands for, or null when it is not a Minecraft slug. */
export function editionOf(gameSlug: string | null | undefined): MinecraftEdition | null {
    if (gameSlug === MINECRAFT_JAVA_GAME_SLUG) return 'java';
    if (gameSlug === MINECRAFT_BEDROCK_GAME_SLUG) return 'bedrock';
    return null;
}

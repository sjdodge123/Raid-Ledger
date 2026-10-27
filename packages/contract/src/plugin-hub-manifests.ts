/**
 * ROK-1969 — the hub declaration of every plugin, keyed by plugin slug.
 * The api manifests spread these (`hub: HUB_PLUGIN_MANIFESTS.valheim`), the
 * install sheet lists them, and the api + web guard tests check every hub
 * registration against them in both directions: nothing registered without a
 * declaration, nothing declared that no code registers.
 *
 * Adding a hub widget, tab or behaviour? Declare it here under its owning
 * plugin first — shared ones go under `core`. Every plugin also declares its
 * `setup` (§3.5, `plugin-setup-requirements.ts`).
 */
import {
  CORE_PLUGIN_ID,
  PluginHubManifestSchema,
  type PluginHubManifest,
} from './plugin-hub-manifest.schema.js';
import {
  BLIZZARD_SETUP,
  CORE_SETUP,
  PELICAN_SETUP,
  VALHEIM_SETUP,
} from './plugin-setup-requirements.js';

const core = {
  widgets: [
    { id: 'gm-post', title: 'Leader post', description: 'The latest leader post.', layoutKey: 'bare' },
    { id: 'discord', title: 'Discord channel', description: 'Recent messages from a linked Discord channel.', layoutKey: 'bare' },
    { id: 'schedule', title: 'Schedule', description: 'Repeating sessions.', layoutKey: 'bare' },
    { id: 'events', title: 'Events', description: 'Upcoming and recent events.', layoutKey: 'bare' },
    { id: 'attendance', title: 'Attendance leaderboard', description: 'Who shows up most.', layoutKey: 'bare' },
    { id: 'gallery', title: 'Gallery', description: 'Recent pictures from this hub — death posts and screenshots.', layoutKey: 'plugin' },
  ],
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'events', label: 'Events' },
    { id: 'resources', label: 'Resources' },
    { id: 'posts', label: 'Posts' },
  ],
  behaviours: [
    { id: 'game_community', kind: 'hub-kind', label: 'Community hubs for any game' },
    { id: 'event-guild-tagger', kind: 'event-tagger', label: 'Tags events with the hub they belong to' },
    { id: 'hub-media.upload', kind: 'ingest-source', label: 'Members upload pictures to the hub Gallery' },
  ],
  setup: CORE_SETUP,
} satisfies PluginHubManifest;

const valheim = {
  widgets: [
    { id: 'claim-banner', title: 'Claim your character', layoutKey: 'plugin' },
    { id: 'deaths', title: 'Deaths', layoutKey: 'plugin' },
  ],
  tabs: [
    { id: 'characters', label: 'Characters' },
    { id: 'map', label: 'Map' },
    { id: 'materials', label: 'Materials' },
    { id: 'planner', label: 'Planner' },
  ],
  behaviours: [
    { id: 'valheim', kind: 'log-parser', label: 'Reads joins, leaves and deaths from the server log' },
    { id: 'valheim', kind: 'scheduled-job', label: 'Imports characters and the map from the server' },
    { id: 'ValheimClaimSuggestCron_scan', kind: 'scheduled-job', label: 'Suggests character claims to players' },
  ],
  gameSlugs: ['valheim'],
  setup: VALHEIM_SETUP,
} satisfies PluginHubManifest;

const pelican = {
  widgets: [
    { id: 'server-hours', title: 'Server hours', layoutKey: 'module' },
    { id: 'recent-arrivals', title: 'Recent arrivals', layoutKey: 'module' },
  ],
  tabs: [{ id: 'quick-play', label: 'Quick Play' }],
  behaviours: [
    { id: 'game_server', kind: 'hub-kind', label: 'Game-server hubs' },
    { id: 'pelican', kind: 'scheduled-job', label: 'Syncs servers and polls their status' },
  ],
  setup: PELICAN_SETUP,
} satisfies PluginHubManifest;

const blizzard = {
  widgets: [
    { id: 'role-composition', title: 'Role composition', layoutKey: 'module' },
    { id: 'members-summary', title: 'Members summary', layoutKey: 'module' },
  ],
  tabs: [
    { id: 'raids', label: 'Raids' },
    { id: 'progression', label: 'Progression', planned: true },
    { id: 'loot', label: 'Loot', planned: true },
  ],
  behaviours: [
    { id: 'wow_guild', kind: 'hub-kind', label: 'World of Warcraft guild hubs' },
    { id: 'blizzard', kind: 'scheduled-job', label: 'Character sync and raid data refresh' },
  ],
  setup: BLIZZARD_SETUP,
} satisfies PluginHubManifest;

/** Every plugin's hub declaration, keyed by plugin slug. */
export const HUB_PLUGIN_MANIFESTS = {
  [CORE_PLUGIN_ID]: core,
  valheim,
  pelican,
  blizzard,
} as const satisfies Readonly<Record<string, PluginHubManifest>>;

/** A plugin slug that has a hub declaration. */
export type HubPluginSlug = keyof typeof HUB_PLUGIN_MANIFESTS;

const BY_SLUG: ReadonlyMap<string, PluginHubManifest> = new Map(
  Object.entries(HUB_PLUGIN_MANIFESTS),
);

/** The hub declaration for `slug`, or `undefined` (never an inherited prop). */
export function hubManifestFor(slug: string): PluginHubManifest | undefined {
  return BY_SLUG.get(slug);
}

/**
 * Every problem in a set of declarations, each naming its slug: a list that
 * fails `PluginHubManifestSchema`, or a `bare` widget outside `core` (bare
 * keys are reserved for the core band). `[]` = valid.
 */
export function hubManifestProblems(
  manifests: Readonly<Record<string, PluginHubManifest>>,
): string[] {
  return Object.entries(manifests).flatMap(([slug, manifest]) => {
    const parsed = PluginHubManifestSchema.safeParse(manifest);
    const issues = (parsed.error?.issues ?? []).map(
      (i) => `${slug}: ${i.path.join('.')} ${i.message}`,
    );
    const bare = slug === CORE_PLUGIN_ID ? [] : manifest.widgets
      .filter((w) => w.layoutKey === 'bare')
      .map((w) => `${slug}: widget "${w.id}" uses layoutKey "bare" (core only)`);
    return [...issues, ...bare];
  });
}

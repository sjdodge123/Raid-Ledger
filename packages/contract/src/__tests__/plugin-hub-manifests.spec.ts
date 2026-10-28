/**
 * ROK-1969 C1/C2 — every plugin's hub declaration parses, ids are unique per
 * list, and only `core` may use bare layout keys.
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_PLUGIN_ID,
  PluginHubManifestSchema,
  type PluginHubManifest,
} from '../plugin-hub-manifest.schema.js';
import {
  HUB_PLUGIN_MANIFESTS,
  hubManifestFor,
  hubManifestProblems,
} from '../plugin-hub-manifests.js';

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const noSetup = { requirements: [] };

const widgetIds = (slug: string): string[] =>
  must(hubManifestFor(slug), slug).widgets.map((w) => w.id);
const tabIds = (slug: string): string[] =>
  must(hubManifestFor(slug), slug).tabs.map((t) => t.id);

describe('HUB_PLUGIN_MANIFESTS (C1)', () => {
  it('declares core, valheim, pelican, blizzard and bg3', () => {
    expect(Object.keys(HUB_PLUGIN_MANIFESTS).sort()).toEqual([
      'bg3',
      'blizzard',
      'core',
      'pelican',
      'valheim',
    ]);
  });

  it.each(Object.entries(HUB_PLUGIN_MANIFESTS))(
    '%s parses unchanged with PluginHubManifestSchema',
    (_slug, manifest) => {
      expect(PluginHubManifestSchema.parse(manifest)).toEqual(manifest);
    },
  );

  it('reports no problems for the shipped declarations', () => {
    expect(hubManifestProblems(HUB_PLUGIN_MANIFESTS)).toEqual([]);
  });

  it('puts the Gallery under core and the core band as bare keys', () => {
    expect(widgetIds(CORE_PLUGIN_ID)).toEqual([
      'gm-post', 'discord', 'schedule', 'events', 'attendance', 'gallery', 'session-note',
      'steam-achievements', 'steam-playtime',
    ]);
    const core = must(hubManifestFor(CORE_PLUGIN_ID), 'core');
    const bare = core.widgets.filter((w) => w.layoutKey === 'bare');
    expect(bare.map((w) => w.id)).not.toContain('gallery');
    expect(bare).toHaveLength(5);
    expect(widgetIds('valheim')).not.toContain('gallery');
  });

  it('declares the tabs each plugin registers on main', () => {
    expect(tabIds(CORE_PLUGIN_ID)).toEqual([
      'overview', 'members', 'events', 'resources', 'posts',
    ]);
    expect(tabIds('valheim')).toEqual(['characters', 'map', 'materials', 'planner']);
    expect(tabIds('pelican')).toEqual(['quick-play']);
    expect(tabIds('blizzard')).toEqual(['raids', 'progression', 'loot']);
  });

  it('rejects a duplicate widget id within one list', () => {
    const dup = {
      widgets: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }],
      setup: { requirements: [] },
    };
    const result = PluginHubManifestSchema.safeParse(dup);
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'Duplicate widgets id "a"',
    ]);
  });

  it('allows the same behaviour id under two different kinds', () => {
    const behaviours = [
      { id: 'valheim', kind: 'log-parser', label: 'A' },
      { id: 'valheim', kind: 'scheduled-job', label: 'B' },
    ];
    expect(PluginHubManifestSchema.safeParse({ behaviours, setup: noSetup }).success).toBe(true);
  });

  it('returns undefined for an unknown or inherited slug', () => {
    expect(hubManifestFor('ghost')).toBeUndefined();
    expect(hubManifestFor('constructor')).toBeUndefined();
  });
});

describe('hubManifestProblems (C2)', () => {
  const bareUnderBlizzard: PluginHubManifest = {
    widgets: [{ id: 'sneaky', title: 'Sneaky', layoutKey: 'bare' }],
    tabs: [],
    behaviours: [],
    setup: noSetup,
  };

  it('names the slug when a non-core plugin declares a bare widget', () => {
    expect(
      hubManifestProblems({ ...HUB_PLUGIN_MANIFESTS, blizzard: bareUnderBlizzard }),
    ).toEqual(['blizzard: widget "sneaky" uses layoutKey "bare" (core only)']);
  });

  it('names the slug when a declaration does not parse', () => {
    const broken: PluginHubManifest = {
      widgets: [{ id: 'Bad Id', title: 'x', layoutKey: 'plugin' }],
      tabs: [],
      behaviours: [],
      setup: noSetup,
    };
    expect(hubManifestProblems({ valheim: broken })).toEqual([
      'valheim: widgets.0.id Invalid id',
    ]);
  });
});

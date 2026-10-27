/**
 * ROK-1969 C3 — the Gallery moved from Valheim to Core; a saved layout that
 * still carries `plugin:valheim:gallery` parses and normalises to the new id
 * without moving anything else.
 */
import { describe, expect, it } from 'vitest';
import {
  HubWidgetPrefsSchema,
  LEGACY_HUB_WIDGET_IDS,
  normaliseHubWidgetPrefs,
} from '../hub-widget-prefs.schema.js';

const OLD = 'plugin:valheim:gallery';
const NEW = 'plugin:core:gallery';

describe('LEGACY_HUB_WIDGET_IDS', () => {
  it('maps the Valheim Gallery id to the Core one', () => {
    expect(LEGACY_HUB_WIDGET_IDS.get(OLD)).toBe(NEW);
  });

  it('still accepts a stored layout holding the old id', () => {
    const stored = { order: [OLD, 'events'], hidden: [], added: [] };
    expect(HubWidgetPrefsSchema.safeParse(stored).success).toBe(true);
  });
});

describe('normaliseHubWidgetPrefs (C3)', () => {
  it('renames the old id in order, hidden, added and config only', () => {
    const prefs = {
      order: ['gm-post', OLD, 'events'],
      hidden: [OLD, 'discord'],
      added: [OLD],
      config: { [OLD]: { x: 1 }, 'generic:text': { title: 't', body: 'b' } },
    };
    expect(normaliseHubWidgetPrefs(prefs)).toEqual({
      order: ['gm-post', NEW, 'events'],
      hidden: [NEW, 'discord'],
      added: [NEW],
      config: { [NEW]: { x: 1 }, 'generic:text': { title: 't', body: 'b' } },
    });
  });

  it('collapses old + new duplicates, keeping the first position', () => {
    const prefs = { order: [OLD, 'events', NEW], hidden: [NEW, OLD], added: [], config: {} };
    const out = normaliseHubWidgetPrefs(prefs);
    expect(out.order).toEqual([NEW, 'events']);
    expect(out.hidden).toEqual([NEW]);
  });

  it('keeps the first config entry when both ids carry settings', () => {
    const prefs = { order: [], hidden: [], added: [], config: { [NEW]: 'a', [OLD]: 'b' } };
    expect(normaliseHubWidgetPrefs(prefs).config).toEqual({ [NEW]: 'a' });
  });

  it('returns an equal object and leaves the input untouched when nothing is legacy', () => {
    const prefs = { order: ['events'], hidden: [], added: [], config: {} };
    const copy = structuredClone(prefs);
    expect(normaliseHubWidgetPrefs(prefs)).toEqual(copy);
    expect(prefs).toEqual(copy);
  });

  it('yields prefs that still pass the schema', () => {
    const prefs = HubWidgetPrefsSchema.parse({ order: [OLD], hidden: [], added: [OLD] });
    expect(HubWidgetPrefsSchema.safeParse(normaliseHubWidgetPrefs(prefs)).success).toBe(true);
  });
});

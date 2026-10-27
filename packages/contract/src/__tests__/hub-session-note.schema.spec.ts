/**
 * ROK-1968 §8.1 — "Before next session" contract: the editor-save limits,
 * the non-empty refine, the optional row id, and the Core manifest entry.
 */
import { describe, expect, it } from 'vitest';
import {
  HUB_SESSION_NOTE_ITEMS_MAX,
  HUB_SESSION_NOTE_ITEM_TEXT_MAX,
  HubSessionNoteResponseSchema,
  PutHubSessionNoteSchema,
  TickHubSessionNoteItemSchema,
} from '../hub-session-note.schema.js';
import { HUB_POST_BODY_MAX } from '../hub-posts.schema.js';
import { CORE_PLUGIN_ID } from '../plugin-hub-manifest.schema.js';
import { HUB_PLUGIN_MANIFESTS, hubManifestProblems } from '../plugin-hub-manifests.js';

const put = (over: Record<string, unknown> = {}) => ({
  body: 'Bring 20 potions',
  items: [],
  clearAfterNextEvent: false,
  baseUpdatedAt: null,
  ...over,
});

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Item ${i + 1}` }));

describe('PutHubSessionNoteSchema', () => {
  it('T-C1 rejects a blank body with zero items', () => {
    const result = PutHubSessionNoteSchema.safeParse(put({ body: '   \n ', items: [] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'Add a note or at least one checklist item',
    );
  });

  it('accepts a blank body when there is at least one item, and a body with no items', () => {
    expect(PutHubSessionNoteSchema.safeParse(put({ body: '', items: items(1) })).success).toBe(true);
    expect(PutHubSessionNoteSchema.safeParse(put()).success).toBe(true);
  });

  it('T-C2 enforces the ruled limits (20 items, 200 chars each, 4000-char body)', () => {
    expect(HUB_SESSION_NOTE_ITEMS_MAX).toBe(20);
    expect(HUB_SESSION_NOTE_ITEM_TEXT_MAX).toBe(200);
    expect(HUB_POST_BODY_MAX).toBe(4000);
    expect(PutHubSessionNoteSchema.safeParse(put({ items: items(20) })).success).toBe(true);
    expect(PutHubSessionNoteSchema.safeParse(put({ items: items(21) })).success).toBe(false);
    const at = (len: number) => put({ items: [{ text: 'x'.repeat(len) }] });
    expect(PutHubSessionNoteSchema.safeParse(at(200)).success).toBe(true);
    expect(PutHubSessionNoteSchema.safeParse(at(201)).success).toBe(false);
    expect(PutHubSessionNoteSchema.safeParse(put({ body: 'x'.repeat(4000) })).success).toBe(true);
    expect(PutHubSessionNoteSchema.safeParse(put({ body: 'x'.repeat(4001) })).success).toBe(false);
  });

  it('rejects a whitespace-only item and unknown keys', () => {
    expect(PutHubSessionNoteSchema.safeParse(put({ items: [{ text: '   ' }] })).success).toBe(false);
    expect(PutHubSessionNoteSchema.safeParse(put({ extra: 1 })).success).toBe(false);
  });

  it('T-C3 parses a new row without an id key and keeps an existing row id', () => {
    const parsed = PutHubSessionNoteSchema.parse(
      put({ items: [{ text: 'New row' }, { id: 7, text: 'Kept row' }] }),
    );
    const [fresh, kept] = parsed.items;
    expect(fresh).toEqual({ text: 'New row' });
    expect(fresh !== undefined && 'id' in fresh).toBe(false);
    expect(kept).toEqual({ id: 7, text: 'Kept row' });
  });
});

describe('response + tick shapes', () => {
  it('parses an empty-note response', () => {
    const empty = { note: null, viewer: { canEdit: false, canTick: false }, nextEvent: null };
    expect(HubSessionNoteResponseSchema.safeParse(empty).success).toBe(true);
  });

  it('parses a pinned note without exposing who ticked', () => {
    const when = '2026-10-27T19:00:00.000Z';
    const note = {
      body: '',
      items: [{ id: 1, text: 'Repair gear', done: true, doneAt: when }],
      updatedAt: when,
      updatedBy: null,
      clearAfter: { eventId: 3, title: 'Raid night', startTime: when, endTime: when },
    };
    const res = { note, viewer: { canEdit: true, canTick: true }, nextEvent: null };
    expect(HubSessionNoteResponseSchema.safeParse(res).success).toBe(true);
    const withDoneBy = { ...note, items: [{ ...note.items[0], doneBy: 9 }] };
    expect(HubSessionNoteResponseSchema.safeParse({ ...res, note: withDoneBy }).success).toBe(false);
  });

  it('accepts only { done }', () => {
    expect(TickHubSessionNoteItemSchema.safeParse({ done: true }).success).toBe(true);
    expect(TickHubSessionNoteItemSchema.safeParse({ done: true, text: 'x' }).success).toBe(false);
  });
});

describe('Core manifest (T-C4)', () => {
  it('declares session-note under core with layoutKey plugin, and the manifests stay clean', () => {
    const widget = HUB_PLUGIN_MANIFESTS[CORE_PLUGIN_ID].widgets.find((w) => w.id === 'session-note');
    expect(widget).toEqual({
      id: 'session-note',
      title: 'Before next session',
      description: 'A shared note and checklist for the next session.',
      layoutKey: 'plugin',
    });
    expect(hubManifestProblems(HUB_PLUGIN_MANIFESTS)).toEqual([]);
  });
});

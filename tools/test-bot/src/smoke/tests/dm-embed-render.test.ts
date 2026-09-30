/**
 * DM embed chrome, asserted at smoke tier through a DEMO_MODE render seam.
 *
 * The companion bot cannot read a DM another bot sends (Discord 50007), so the
 * DM half of the shared embed chrome was pinned at unit tier only. The fixture
 * `POST /admin/test/render-dm-embed` runs the deployed API's REAL notification
 * DM builder, with the configured community name, and returns the rendered
 * embed + button rows as Discord API JSON. It is synchronous — nothing is
 * queued or sent — so no polling is needed.
 *
 * One case per state register (needs_you / announcing / cancelled). Each pins:
 *  - author line = the configured community name (read from /system/branding,
 *    not from the response under test)
 *  - footer = `<community> · <type label>`
 *  - colour = the state colour (constants below, copied from the API)
 *  - the description carries no raw Discord tokens
 *  - at least one button, and the embed passes the shared render rules
 */
import {
  assertEmbedColor,
  assertEmbedRenderRules,
  assertNoDiscordTokens,
  SmokeAssertionError,
} from '../assert.js';
import type { SimpleEmbed } from '../../helpers/messages.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

/** EMBED_COLORS.REMINDER (api/src/discord-bot/discord-bot.constants.ts) — `needs_you`. */
const REMINDER_AMBER = 0xf59e0b;
/** EMBED_COLORS.ANNOUNCEMENT (same file) — `announcing`. */
const ANNOUNCEMENT_CYAN = 0x38bdf8;
/** EMBED_COLORS.ERROR (same file) — `cancelled`. */
const CANCELLED_RED = 0xef4444;

/** discord-api-types ComponentType.Button. */
const BUTTON_COMPONENT_TYPE = 2;

/** Same fallback the API applies when no community name is configured. */
const DEFAULT_COMMUNITY = 'Raid Ledger';

interface RenderedDmEmbed {
  communityName: string;
  embed: {
    title?: string;
    description?: string;
    color?: number;
    author?: { name?: string };
    footer?: { text?: string };
    fields?: { name: string; value: string; inline?: boolean }[];
    timestamp?: string;
  };
  components: { components?: { type?: number; label?: string }[] }[];
}

interface RenderCase {
  type: 'event_reminder' | 'new_event' | 'event_cancelled';
  /** `getTypeLabel` in api/src/notifications/notification-embed.helpers.ts. */
  label: string;
  color: number;
  register: string;
}

const CASES: RenderCase[] = [
  { type: 'event_reminder', label: 'Event Reminder', color: REMINDER_AMBER, register: 'needs_you amber' },
  { type: 'new_event', label: 'New Event', color: ANNOUNCEMENT_CYAN, register: 'announcing cyan' },
  { type: 'event_cancelled', label: 'Event Cancelled', color: CANCELLED_RED, register: 'cancelled red' },
];

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

/** The community name the API itself reads (`community_name` branding). */
async function expectedCommunityName(api: ApiClient): Promise<string> {
  const branding = await api.get<{ communityName: string | null }>(
    '/system/branding',
  );
  return branding?.communityName ?? DEFAULT_COMMUNITY;
}

function renderDmEmbed(api: ApiClient, c: RenderCase): Promise<RenderedDmEmbed> {
  return api.post<RenderedDmEmbed>('/admin/test/render-dm-embed', {
    type: c.type,
    title: `render-dm-embed ${c.type}`,
    message: `Smoke render of the ${c.type} DM embed.`,
    payload: { eventId: 1, eventTitle: 'Render Raid', gameName: 'Render Game' },
  });
}

function toSimpleEmbed(e: RenderedDmEmbed['embed']): SimpleEmbed {
  return {
    title: e.title ?? null,
    author: e.author?.name ?? null,
    description: e.description ?? null,
    color: e.color ?? null,
    fields: (e.fields ?? []).map((f) => ({ ...f, inline: f.inline ?? false })),
    footer: e.footer?.text ?? null,
    thumbnail: null,
    timestamp: e.timestamp ?? null,
  };
}

function assertChrome(embed: SimpleEmbed, community: string, c: RenderCase) {
  if (embed.author !== community) {
    fail(`${c.type}: expected author "${community}", got "${embed.author}"`);
  }
  const footer = `${community} · ${c.label}`;
  if (embed.footer !== footer) {
    fail(`${c.type}: expected footer "${footer}", got "${embed.footer}"`);
  }
  assertEmbedColor(embed, c.color);
  assertNoDiscordTokens(embed.description ?? '');
  assertEmbedRenderRules(embed);
}

function assertHasAnyButton(res: RenderedDmEmbed, c: RenderCase) {
  const buttons = res.components.flatMap((r) => r.components ?? []);
  if (!buttons.some((b) => b.type === BUTTON_COMPONENT_TYPE)) {
    fail(`${c.type}: expected at least one button, got ${JSON.stringify(res.components)}`);
  }
}

function renderTest(c: RenderCase): SmokeTest {
  return {
    name: `render-dm-embed: ${c.type} DM chrome (${c.register})`,
    category: 'dm',
    async run(ctx: TestContext) {
      const community = await expectedCommunityName(ctx.api);
      const res = await renderDmEmbed(ctx.api, c);
      if (res.communityName !== community) {
        fail(`${c.type}: seam resolved community "${res.communityName}", branding says "${community}"`);
      }
      assertChrome(toSimpleEmbed(res.embed), community, c);
      assertHasAnyButton(res, c);
    },
  };
}

export const dmEmbedRenderTests: SmokeTest[] = CASES.map(renderTest);

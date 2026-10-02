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
 *  - button rows in the order `sendEmbedDM` sends them: type-specific rows
 *    first (event_reminder's Roach Out row), the primary row last
 *  - the embed passes the shared render rules
 *
 * Plus one PUG fill-request case through `POST /admin/test/render-pug-invite-embed`,
 * which runs the REAL `buildPugInviteEmbed` against a seeded event. An invite
 * DM's author is the `◌ FILL NEEDED · starts in …` line, not the community, so
 * it has its own chrome checks (`assertPugChrome`) rather than `assertChrome`.
 * It proves the amber colour, the FILL NEEDED author line, the role footer
 * (against /system/branding), no masked link and the Accept / Decline /
 * View Event row and URL. It does NOT prove the ≤2 personalized-field cap or
 * the absent Voice Channel field: the seam never resolves a voice channel, the
 * loader trims fields upstream and this suite seeds no library rows. Those are
 * pinned at unit tier (`pug-invite.helpers.spec.ts`, the seam's controller spec).
 */
import {
  assertEmbedColor,
  assertEmbedRenderRules,
  assertNoDiscordTokens,
  SmokeAssertionError,
} from '../assert.js';
import { createEvent, deleteEvent } from '../fixtures.js';
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

/** The primary row always ends with this link button (`buildActionRow`). */
const ADJUST_LABEL = 'Adjust Notifications';

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

/** `POST /admin/test/render-pug-invite-embed` — `buildPugInviteEmbed` as JSON. */
interface RenderedPugInvite {
  communityName: string;
  embed: RenderedDmEmbed['embed'];
  components: { components?: { type?: number; label?: string; url?: string }[] }[];
}

const PUG_TAG = 'render-pug-invite-embed';
/** The slot role the seam renders; it becomes the footer label. */
const PUG_ROLE = 'tank';
/**
 * `MAX_PERSONALIZED_FIELDS` in api/src/discord-bot/services/pug-invite.helpers.ts.
 * Here only a sanity bound on the field count, not cap coverage (see header).
 */
const MAX_PERSONALIZED_FIELDS = 2;
/** `pugActionButtons` then `viewEventButton`, as `buildInviteRow` adds them. */
const PUG_ROW_LABELS = ['Accept', 'Decline', 'View Event'];

interface RenderCase {
  type: 'event_reminder' | 'new_event' | 'event_cancelled';
  /** `getTypeLabel` in api/src/notifications/notification-embed.helpers.ts. */
  label: string;
  color: number;
  register: string;
  /** A button on the type-specific row that must come BEFORE the primary row. */
  extraRowLabel?: string;
}

const CASES: RenderCase[] = [
  { type: 'event_reminder', label: 'Event Reminder', color: REMINDER_AMBER, register: 'needs_you amber', extraRowLabel: 'Roach Out' },
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

function rowLabels(res: RenderedDmEmbed): string[][] {
  return res.components.map((r) =>
    (r.components ?? [])
      .filter((b) => b.type === BUTTON_COMPONENT_TYPE)
      .map((b) => b.label ?? ''),
  );
}

/** Rows as `sendEmbedDM` sends them: type-specific rows first, primary last. */
function assertButtonRows(res: RenderedDmEmbed, c: RenderCase) {
  const rows = rowLabels(res);
  const last = rows[rows.length - 1] ?? [];
  if (!last.includes(ADJUST_LABEL)) {
    fail(`${c.type}: expected the last row to be the primary row with "${ADJUST_LABEL}", got ${JSON.stringify(rows)}`);
  }
  if (c.extraRowLabel && !(rows.length > 1 && rows[0].includes(c.extraRowLabel))) {
    fail(`${c.type}: expected a first row with "${c.extraRowLabel}" before the primary row, got ${JSON.stringify(rows)}`);
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
      assertButtonRows(res, c);
    },
  };
}

/** MMO slot config when the env has an MMO game, as dm-notifications does. */
function pugOverrides(ctx: TestContext) {
  if (!ctx.mmoGameId) return {};
  return {
    gameId: ctx.mmoGameId,
    slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
  };
}

function renderPugInvite(ctx: TestContext, eventId: number): Promise<RenderedPugInvite> {
  return ctx.api.post<RenderedPugInvite>('/admin/test/render-pug-invite-embed', {
    eventId,
    role: PUG_ROLE,
    discordUserId: ctx.testBotDiscordId,
  });
}

/** Author = FILL NEEDED line, footer = `<community> · <role>`, amber, render rules. */
function assertPugChrome(embed: SimpleEmbed, community: string) {
  if (!embed.author?.includes('FILL NEEDED')) {
    fail(`${PUG_TAG}: expected the author line to carry "FILL NEEDED", got "${embed.author}"`);
  }
  const footer = `${community} · ${PUG_ROLE}`;
  if (embed.footer !== footer) {
    fail(`${PUG_TAG}: expected footer "${footer}", got "${embed.footer}"`);
  }
  assertEmbedColor(embed, REMINDER_AMBER);
  assertEmbedRenderRules(embed);
}

/**
 * No masked link (View Event is the only route). The field-count bound is a
 * sanity guard-rail against an unexpected extra field, not cap coverage.
 */
function assertPugBody(embed: SimpleEmbed) {
  if ((embed.description ?? '').includes('](')) {
    fail(`${PUG_TAG}: expected no masked link in the description, got "${embed.description}"`);
  }
  const names = embed.fields.map((f) => f.name);
  if (names.length > MAX_PERSONALIZED_FIELDS) {
    fail(`${PUG_TAG}: expected at most ${MAX_PERSONALIZED_FIELDS} fields (sanity bound), got ${names.length}: ${JSON.stringify(names)}`);
  }
}

/** One row ending Accept, Decline, View Event — the link points at the event. */
function assertPugButtons(res: RenderedPugInvite, eventId: number) {
  const row = res.components[res.components.length - 1];
  if (!row) {
    fail(`${PUG_TAG}: expected an Accept / Decline / View Event row, got no components (is CLIENT_URL set?)`);
  }
  const buttons = (row.components ?? []).filter((b) => b.type === BUTTON_COMPONENT_TYPE);
  const labels = buttons.map((b) => b.label ?? '');
  if (JSON.stringify(labels.slice(-PUG_ROW_LABELS.length)) !== JSON.stringify(PUG_ROW_LABELS)) {
    fail(`${PUG_TAG}: expected the row to end ${JSON.stringify(PUG_ROW_LABELS)}, got ${JSON.stringify(labels)}`);
  }
  const url = buttons[buttons.length - 1]?.url ?? '';
  if (!url.endsWith(`/events/${eventId}`)) {
    fail(`${PUG_TAG}: expected the View Event url to end "/events/${eventId}", got "${url}"`);
  }
}

const pugInviteRenderTest: SmokeTest = {
  name: 'render-pug-invite-embed: PUG invite DM chrome (needs_you amber)',
  category: 'dm',
  async run(ctx: TestContext) {
    const community = await expectedCommunityName(ctx.api);
    const ev = await createEvent(ctx.api, 'render-pug', pugOverrides(ctx));
    try {
      const res = await renderPugInvite(ctx, ev.id);
      if (res.communityName !== community) {
        fail(`${PUG_TAG}: seam resolved community "${res.communityName}", branding says "${community}"`);
      }
      const embed = toSimpleEmbed(res.embed);
      assertPugChrome(embed, community);
      assertPugBody(embed);
      assertPugButtons(res, ev.id);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const dmEmbedRenderTests: SmokeTest[] = [...CASES.map(renderTest), pugInviteRenderTest];

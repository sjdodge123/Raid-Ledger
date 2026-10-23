/**
 * ROK-1933 — the Valheim suggested-claim DM, at smoke tier.
 *
 * The companion bot cannot read a DM another bot sends (Discord 50007), so
 * the DM is asserted in two halves against the deployed API:
 *
 *  1. The REAL pipeline picks the candidate: `claim-drive-fixture` seeds a
 *     fresh hub member B plus an unclaimed character named exactly B's
 *     display name, on the server right now (a Steam-only sighting), and
 *     `claim-suggest-scan` runs one scan with its clock pushed past the
 *     10-minute minimum age. The scan must dispatch at least one DM.
 *     ("At least": an earlier run's sighting on another worker's server can
 *     add to the count; the per-pair dedupe key keeps it from re-sending.)
 *  2. The REAL notification DM builder renders this type: the
 *     `render-dm-embed` seam runs `buildNotificationEmbed` for
 *     `valheim_claim_suggestion` with the seeded character's id. It pins the
 *     title + body (copy mirrored from
 *     `api/src/plugins/valheim/armory/identity/valheim-claim-suggest.copy.ts`,
 *     the way the DM-render smoke mirrors its colour constants), the
 *     `vclaim:yes:<id>` / `vclaim:no:<id>` row BEFORE the primary row, and the
 *     `[Open the hub]` link. The seam passes title/body through, so the copy
 *     strings themselves stay pinned at unit tier (the copy spec); this proves
 *     the deployed builder renders them and the buttons for this type.
 *
 * Button presses are integration-tested (bots cannot click another bot's
 * components). No Discord channel is written; the fixture's users,
 * characters and sighting are deleted in `finally` (`claim-drive-cleanup`).
 */
import { assertEmbedRenderRules, SmokeAssertionError } from "../assert.js";
import type { SimpleEmbed } from "../../helpers/messages.js";
import { cleanupClaimDrive } from "../claim-drive-cleanup.js";
import type { SmokeTest, TestContext } from "../types.js";

/** A worker slot the Playwright claim spec (workers 0..N) does not use. */
const WORKER = 15;
/** `upsertClaimDriveServer`: the server (and its hub) is `Claimheim <worker>`. */
const HUB_NAME = `Claimheim ${String(WORKER)}`;
const TYPE = "valheim_claim_suggestion";
/** `getEmojiForType` in api/src/notifications/notification-embed.helpers.ts. */
const TYPE_EMOJI = "\u{1F6E1}️";
/** `getTypeLabel` for the type (same file); the footer ends with it. */
const TYPE_LABEL = "Raid Ledger · Valheim";
/** `CLAIM_SUGGEST_COPY` (placeholder copy until the operator rules Q2). */
const COPY = {
  title: (name: string) => `Is ${name} yours?`,
  lead: (name: string, hub: string) => `${name} is playing on ${hub} right now`,
  reasonName: ", and the name looks like yours.",
  ask: "If it's your character, claim it to see its gear, skills and chests on Raid Ledger.",
  tip: "Tip: link Steam once and every character you play is claimed automatically.",
  yes: "Yes, it's mine",
  no: "Not me",
  openHub: "Open the hub",
};
/** Any origin works: the link button uses the payload's `hubUrl` verbatim. */
const CLIENT_URL = "https://smoke.raid-ledger.invalid";

interface ClaimDriveFixture {
  guildId: number;
  users: { b: { id: number; displayName: string } };
  characters: { matching: { id: number; name: string } };
}

interface RenderedButton {
  type?: number;
  label?: string;
  url?: string;
  custom_id?: string;
}
interface RenderedClaimDm {
  embed: {
    title?: string;
    description?: string;
    color?: number;
    author?: { name?: string };
    footer?: { text?: string };
    fields?: { name: string; value: string; inline?: boolean }[];
  };
  components: { components?: RenderedButton[] }[];
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

async function seedSighting(ctx: TestContext): Promise<ClaimDriveFixture> {
  const res = await ctx.api.post<ClaimDriveFixture>(
    "/admin/test/valheim/claim-drive-fixture",
    { worker: WORKER, sighting: true },
  );
  if (typeof res?.characters?.matching?.id !== "number") {
    fail(`claim-drive-fixture: no matching character in ${JSON.stringify(res)}`);
  }
  return res;
}

/** The scan must pick the seeded candidate and dispatch its DM. */
async function expectScanQueues(ctx: TestContext): Promise<void> {
  const res = await ctx.api.post<{ queued?: unknown }>(
    "/admin/test/valheim/claim-suggest-scan",
  );
  if (typeof res?.queued !== "number" || res.queued < 1) {
    fail(
      `claim-suggest-scan: expected queued >= 1 (B's DM about the seeded ` +
        `sighting), got ${JSON.stringify(res)}`,
    );
  }
}

/** The body `ValheimClaimSuggestService.send` builds for a name match. */
function expectedBody(name: string): string {
  return `${COPY.lead(name, HUB_NAME)}${COPY.reasonName} ${COPY.ask}\n\n${COPY.tip}`;
}

function renderClaimDm(
  ctx: TestContext,
  fx: ClaimDriveFixture,
  hubUrl: string,
): Promise<RenderedClaimDm> {
  const name = fx.characters.matching.name;
  return ctx.api.post<RenderedClaimDm>("/admin/test/render-dm-embed", {
    type: TYPE,
    title: COPY.title(name),
    message: expectedBody(name),
    payload: {
      profileId: fx.characters.matching.id,
      guildId: fx.guildId,
      characterName: name,
      hubUrl,
    },
  });
}

function expectChrome(dm: RenderedClaimDm, name: string): void {
  const e = dm.embed;
  const wantTitle = `${TYPE_EMOJI} ${COPY.title(name)}`;
  if (e.title !== wantTitle) {
    fail(`claim DM title: expected "${wantTitle}", got "${String(e.title)}"`);
  }
  if (e.description !== expectedBody(name)) {
    fail(`claim DM body: expected "${expectedBody(name)}", got "${String(e.description)}"`);
  }
  if (!e.footer?.text?.endsWith(TYPE_LABEL)) {
    fail(`claim DM footer: expected "… ${TYPE_LABEL}", got "${String(e.footer?.text)}"`);
  }
  assertEmbedRenderRules(toSimpleEmbed(e));
}

function toSimpleEmbed(e: RenderedClaimDm["embed"]): SimpleEmbed {
  return {
    title: e.title ?? null,
    author: e.author?.name ?? null,
    description: e.description ?? null,
    color: e.color ?? null,
    fields: (e.fields ?? []).map((f) => ({ ...f, inline: f.inline ?? false })),
    footer: e.footer?.text ?? null,
    thumbnail: null,
    timestamp: null,
  };
}

const describeRows = (dm: RenderedClaimDm): string =>
  JSON.stringify(dm.components.map((r) => r.components ?? []));

/** Row 1 = [Yes, it's mine][Not me] with the profile's ids; last row links the hub. */
function expectButtons(dm: RenderedClaimDm, profileId: number, hubUrl: string): void {
  const first = dm.components[0]?.components ?? [];
  const got = first.map((b) => `${String(b.label)}=${String(b.custom_id)}`);
  const want = [`${COPY.yes}=vclaim:yes:${String(profileId)}`, `${COPY.no}=vclaim:no:${String(profileId)}`];
  if (dm.components.length < 2 || got.join() !== want.join()) {
    fail(`claim DM rows: expected first row [${want.join(", ")}] before the primary row, got ${describeRows(dm)}`);
  }
  const primary = dm.components[dm.components.length - 1]?.components ?? [];
  const open = primary.find((b) => b.label === COPY.openHub);
  if (open?.url !== hubUrl) {
    fail(`claim DM primary row: expected [${COPY.openHub}] → ${hubUrl}, got ${describeRows(dm)}`);
  }
}

async function claimDmRendersButtons(ctx: TestContext): Promise<void> {
  try {
    await scanAndRender(ctx);
  } finally {
    await cleanupClaimDrive(ctx, WORKER); // ROK-1933: no fixture users leak
  }
}

async function scanAndRender(ctx: TestContext): Promise<void> {
  const fx = await seedSighting(ctx);
  await expectScanQueues(ctx);
  const hubUrl = `${CLIENT_URL}/hubs/${String(fx.guildId)}#characters`;
  const dm = await renderClaimDm(ctx, fx, hubUrl);
  expectChrome(dm, fx.characters.matching.name);
  expectButtons(dm, fx.characters.matching.id, hubUrl);
}

export const valheimClaimDmTests: SmokeTest[] = [
  {
    name: "ROK-1933 claim DM: scan queues it; renders title, body and vclaim buttons",
    category: "dm",
    // The scan reads every live sighting; keep it off the parallel pool.
    serial: true,
    run: claimDmRendersButtons,
  },
];

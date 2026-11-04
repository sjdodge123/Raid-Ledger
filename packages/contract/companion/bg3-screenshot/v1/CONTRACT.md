# Raid Ledger Companion `bg3-screenshot` wire contract — v1

**Owner: Raid Ledger.** One Baldur's Gate 3 screenshot, found by the
Companion's `bg3-screenshot` collector in Steam's per-game screenshot folder
(app 1086940), re-encoded on the device to a WebP and pushed as one envelope
(`contract: "bg3-screenshot"`, `contractVersion: 1`). The screenshot lands in
the chosen BG3 hub's Gallery as `kind: 'screenshot'`. rl-companion pins a copy
of this folder. Shared rules: [`../../README.md`](../../README.md). Story:
ROK-1966 (rulings Q1–Q4, 2026-11-03).

| What | Where |
|---|---|
| Message + payload Zod (source of truth) | `packages/contract/src/companion-bg3-screenshot.schema.ts` — `Bg3ScreenshotMessageSchema`, `Bg3ScreenshotPayloadSchema`, `BG3_SCREENSHOT_CONTRACT_ID` |
| Hub id primitive | `packages/contract/src/companion-common.schema.ts` — `CompanionHubGuildIdSchema` |
| JSON Schema of one message (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) (all synthetic) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Conformance + drift guard (contract vitest) | `packages/contract/src/__tests__/companion-bg3-screenshot-contract.spec.ts` |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Transport

Everything in the envelope contract ([`../../envelope/v1/CONTRACT.md`](../../envelope/v1/CONTRACT.md))
applies: `POST /companion/v1/messages/bg3-screenshot`, device bearer token,
gzip allowed, two-stage parse, ack and error codes, 5-minute clock rule.
Registry entry: `maxBytes: 4_096`, `blobSlots: ['image']`, `status: 'current'`.

The WebP goes up first through the existing blob store
(`PUT /companion/v1/blobs/:sha256`, WebP only, header-checked, at most
`COMPANION_WEBP_MAX_BYTES` = 1 MiB). The message then references it by
`payload.image.sha256`. There is no server-side decoder of JPEG/PNG: the app
re-encodes (ruling Q4).

## 2. Payload fields (`Bg3ScreenshotPayloadSchema`, strict)

Every field is required. Every object is strict: an unknown key rejects the
message.

| Field | Type | Notes |
|---|---|---|
| `takenAt` | ISO-8601 UTC `Z`, ≤ 24 chars | The source file's mtime. MUST NOT be after the envelope's `capturedAt`. Only files taken after the user opted in are sent (ruling Q2, no backfill) — enforced by the app, not the server. |
| `width`, `height` | int 1–16384 (`BG3_SCREENSHOT_SOURCE_EDGE_MAX`) | Size of the ORIGINAL capture, before the re-encode. |
| `image` | WebP blob ref (`CompanionWebpRefSchema`) | `sha256` (lowercase hex 64), `byteLength` 1–1048576, `contentType: "image/webp"`, `width`/`height` 1–4096 (`COMPANION_IMAGE_EDGE_MAX`). The WebP is never larger than the original: `image.width ≤ width` and `image.height ≤ height` (Zod refinement). `image.sha256` is the server's dedupe key — the same bytes never make a second Gallery row. |
| `target.hubGuildId` | int 1–2147483647 (`CompanionHubGuildIdSchema`) | The hub the user picked for screenshots in the app (ruling Q3). See §3. |

## 3. Target hub (`target.hubGuildId`)

A screenshot carries no campaign key, so the user picks ONE BG3 hub in the
Companion. The id is the hub's `guilds.id` — the same id as the web route
`/hubs/:guildId` and `bg3_campaigns.guild_id`, which is what the `bg3-save`
handler already checks membership against (`isHubMember(tx, userId, guildId)`
after `resolveCampaign`). Using it means the server needs no second lookup and
no new identifier.

The app learns the hubs it may offer from `GET /companion/v1/config`: the
`bg3-screenshot` contract entry carries an optional `hubTargets` list
(`CompanionConfigHubTargetSchema`: `{ hubGuildId, name, isDefault }`, at most
100). `isDefault` marks the pre-selected hub — the hub bound to the campaign of
the caller's most recent save. An older server omits the key.

Server-only rules (not in the schema):

- The uploader MUST be a live member of `target.hubGuildId`, and it MUST be a
  BG3 hub whose plugin is active. Otherwise the message is refused and nothing
  is stored. The app must treat an unknown error code as a generic terminal 4xx.
- The referenced blob must already be stored.
- When the hub hides screenshots (`hideLocationAndScreenshots`), the row is
  stored but not shown, the same rule as save thumbnails.
- Each user may store at most 20 screenshots an hour across all hubs
  (`HUB_MEDIA_COMPANION_PER_HOUR`; a fixed one-hour window). Past it the
  message is refused with `rate_limited` (429), which is retryable; this answer
  carries no `Retry-After`, so the app keeps the screenshot queued and retries
  later (minutes, not seconds). A replay of a stored screenshot acks `stale`
  and does not count.
- When the hub's Gallery is full (the per-hub storage cap shared with Discord
  pictures and member uploads), the message is refused with
  `blob_quota_exceeded` (413). For this contract that code means "the hub's
  Gallery is full", not only "your blob quota is spent"; nothing the app
  deletes from its own blobs fixes it, so it should stop retrying that
  screenshot and tell the user.
- A screenshot the hub already holds — live, Removed by a leader, or withdrawn
  through "Delete my BG3 data" — is never re-added; sending it again acks
  `stale`.

## 4. Refinements (Zod only — not in `schema.json`)

1. `payload.image.width ≤ payload.width` (issue `custom` at `payload.image.width`).
2. `payload.image.height ≤ payload.height` (issue `custom` at `payload.image.height`).
3. `payload.takenAt ≤ capturedAt` (issue `custom` at `payload.takenAt`).

## 5. Fixtures

Every fixture is **synthetic**: no real screenshot, file name, Steam id, path,
hub name or GUID. The blob hashes are made-up hex; there is no image file in
this folder because the message only references the blob.

- `steam-1080p` — 1920×1080 capture sent at full size.
- `ultrawide-downscaled` — 5120×1440 capture downscaled to 4096×1152, a WebP
  at exactly 1 MiB, millisecond `takenAt`, the largest hub id.
- `invalid/` — one mutation each of `steam-1080p`; `EXPECTED.json` maps each to
  the Zod issue `{ path, code }` it must raise.

## 6. Versioning

See [`../../README.md`](../../README.md) rule 3. v1 is the initial version.

# Runbook — rl-companion dev bridge (agents)

Story ROK-2055. Wire format: `packages/contract/companion/dev-bridge/v1/`
(`CONTRACT.md`, `schema.json`, `allowlist.json`). Operator rulings R0/R1
(2026-11-01) are binding.

## What it is

A LAN-only HTTPS listener inside **rl-companion** on the operator's Windows
desktop (off by default, bearer token, address allowlist). skeleton-key (on
the NAS) registers it as the `http` target `rl-companion`, so an agent on the
MacBook reads companion state and WoW addon data — and queues in-game
**probes** — without the operator copying anything between machines.

## When to use it

You need a fact that only exists inside the WoW client or its SavedVariables
(what an API returns on the Forever client, what LedgerLink wrote, which
addons are installed). **Never ask the operator to paste probe output, run a
script in game, or `/reload` for you.**

## Reads — free, no prompt

`http_rl-companion_get { path: "/dev/v1/…" }`:

| Need | Path |
|---|---|
| Is the bridge up, which flavors exist, is WoW running | `/dev/v1/health` |
| Installed addons (from `.toc` headers) | `/dev/v1/addons?flavor=<flavor>` |
| LedgerLink SavedVariables, raw text | `/dev/v1/ledgerlink/sv?flavor=<flavor>&scope=account` |
| Mailworthy / BugGrabber / DungeonBuddy SavedVariables, raw text (only these three) | `/dev/v1/addons/Mailworthy/sv?flavor=<flavor>&scope=account` (or `/dev/v1/addons/!BugGrabber/sv?…` — `%21BugGrabber` also works — or `/dev/v1/addons/DungeonBuddy/sv?…`) |
| LedgerLink SavedVariables, parsed (GUIDs hashed) | `/dev/v1/ledgerlink/sv/parsed?flavor=<flavor>` |
| Probe status / answer | `/dev/v1/probes`, `/dev/v1/probes/<probeId>` |
| Companion log (redacted) | `/dev/v1/logs?since=<iso>&level=warn` |
| Collector status (per row: optional `status` = the tile's status line; top-level optional `linked` = this device is linked) | `/dev/v1/collectors` |
| Companion activity, structured only (scan / upload outcomes, HTTP status, error code; never free text) | `/dev/v1/events?since=<iso>` |
| What changed in the client, and when (dev snapshot history) | `/dev/v1/ledgerlink/snapshot/history?flavor=<flavor>` |
| One dev snapshot: build, `Enum.GameRule`, API presence, S1/S3/S9 | `/dev/v1/ledgerlink/snapshot?flavor=<flavor>&character=<characterKey>&at=<snapshotId>` |
| BG3 saves the collector sees (redacted: `saveRef`, versions, party/co-op counts, fallback reason) | `/dev/v1/bg3/saves` |
| One BG3 save's NewAge type table, decoder status, S0 checks and decoded party stats | `/dev/v1/bg3/saves/<saveRef>/structure` |

Bodies are ≤16 KiB. When `next` is not `null`, fetch the next page with
`?cursor=<next>` (keep the other query params).

## In-game facts without a probe (dev snapshot)

With `/rl dev on`, LedgerLink writes a diagnostic snapshot on every save and
the companion keeps the latest plus 7 days (CONTRACT.md → "LedgerLink dev
snapshot"). Check `/snapshot/history` first — a new row means the client's
answer changed (`clientBuild`, `missingApis`, `activeRules`) — then read that
row with `/snapshot?at=<snapshotId>` (page through `next`). A 404 means
nothing is cached: the operator has not typed `/rl dev on` once, or has not
saved since. Say so in your report; do not ask them to `/reload`. Prefer this
over queuing a probe whenever the snapshot already holds the fact.

## Probes — execute tier (the operator approves each)

Probes run inside **LedgerLink** itself — there is no separate probe addon.
rl-companion writes the queue to `<flavor>/Interface/AddOns/LedgerLink/DevQueue.lua`
and LedgerLink saves each answer under `LedgerLinkDB.dev.probes`. LedgerLink
runs them **only while the operator has `/rl dev on`**; with dev mode off a
probe just waits until it expires.

1. Write a `probe-request` (CONTRACT.md → "Probe request"): read-only calls
   only. Check each `fn` against `allowlist.json` first — a function whose name
   starts with `Get`/`Is`/`Has`/`Can`/`Unit`/`Num` and holds no deny word.
   Use `presence` to ask "does this API exist" without calling it.
2. Submit: `http_rl-companion_request { method: "POST", path: "/dev/v1/probes", body: {…} }`.
   skeleton-key shows the operator an approval prompt. A 202 returns the
   `probeId`; a 400 lists the refused paths (or the flavor's queue already
   holds 50 probes — cancel stale ones first); a 409 `probes_disabled` means the
   operator has "Allow probes" off — tell them, do not retry.
3. **Carry on with other work.** Per R1 the answer arrives in normal play: the
   probe runs at the next UI load (login or `/reload`) and its result is saved
   at the next `/reload`, logout or exit. Nothing in this system forces or
   speeds that up, and you must not ask the operator to.
4. Later, read `/dev/v1/probes/<probeId>`: `answered` carries `result`;
   `expired` means no save happened within `ttlHours` (default 72, counted
   from the time in the `probeId`) — resubmit
   only if still needed; `rejected` carries `error`.
5. Cancel a probe you no longer need: `DELETE /dev/v1/probes/<probeId>` (execute tier).
   Cancelling twice is harmless (200 again); a probe that is already
   `answered`, `expired` or `rejected` cannot be cancelled (400).

### Timing — the SavedVariables round-trip

The game writes SavedVariables only at `/reload` or logout, so an answer
needs two saves after the POST:

1. `/rl dev on` (once; it persists).
2. A `/reload` (or login) — LedgerLink picks up the queue and runs the probe
   at its `after` event.
3. Another `/reload` or a logout — the answer is saved to
   `LedgerLinkDB.dev.probes`.
4. The companion then needs time to notice the save and flip the probe to
   `answered`. Observed 2026-11-15: ~10 min after the save for the first
   probe, ~1 min for the second.

This is for planning, not a request: these steps happen in the operator's
normal play. Do not ask them to `/reload` for you; read the probe again
later, and if it is still `queued` after a save, allow several minutes
before concluding anything.

### Load-on-demand UI data cannot be probed (ROK-2210, 2026-11-15)

Probes run at a login event (`after`), before the operator opens any window.
Data a Blizzard UI loads on demand is empty then: the Classic-style group
finder (`C_LFGList` categories/activities, `LFGBrowseFrame`) fills only when
the window opens, so a probe of it returns nothing useful.
`GetLFGDungeonInfo` is not a substitute — it gives one level per dungeon,
not the finder's level span.

For **static client data** such as the finder's level spans, read the
client's DB2 tables instead of queuing another probe. wago.tools carries the
Forever client as product `wowf`, e.g.
`https://wago.tools/db2/GroupFinderActivity/csv?build=1.60.1.70938`
(pick the build the dev snapshot's `clientBuild` reports).

A question the grammar cannot express (it needs a loop over a table, a
callback, a write) is not a probe: request a LedgerLink dev-mode change in
the ledger-link repo via a Raid Ledger story.

## Privacy

`sv` raw and probe results can hold guild-member and character names. They
may sit in your transcript; **never commit them**. A real response becomes a
fixture only after anonymisation (no real names, GUIDs, guild names or paths).

## If the target is missing or failing

- `http_rl-companion_*` tools absent → the target is not registered; that is a
  once-only operator pairing step (ROK-2055 C6), not something to work around.
- 401/403 → the token was rotated or the NAS address is not allowlisted; tell
  the operator. Do not try another credential.
- Connection refused → the bridge toggle is off or the desktop is asleep. Note
  it and continue; do not ask the operator to turn it on unless the task
  depends on it.

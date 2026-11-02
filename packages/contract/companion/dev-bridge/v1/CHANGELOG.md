# Companion dev-bridge — changelog

Additive changes (a new optional field a reader may ignore, relaxing a
refinement, ADDING a deny word or `denyExact` name with an `allowlistVersion`
bump) stay in `v1/`. Removing a deny entry or adding an allow prefix loosens
the safety net and needs an explicit operator ruling. Anything else is
breaking and gets a new `vN/` folder; rl-companion accepts the current and
previous version during the transition.

## v1 — 2026-11-02 (ROK-2055)

- Initial contract: the `/dev/v1/*` response bodies of the rl-companion dev
  bridge (health, addons, LedgerLink SavedVariables raw + parsed, probes,
  logs, collectors, errors), the probe grammar (`probe-request`) and the probe
  result the LedgerLinkProbe addon stores (`probe-result`).
- `allowlist.json`: the read-verb allowlist + deny list both rl-companion and
  LedgerLinkProbe apply, with shared example vectors.
- Generated `schema.json` (one `$defs` entry per body), golden fixtures and
  `fixtures/invalid/EXPECTED.json`.
- Review fixes before first release (ROK-2055 C1 review + Codex):
  - allowlist: a read-prefixed last segment holding `_` is refused (FrameXML
    handlers like `UnitPopup_OnClick`); `allowExact` matches the whole path;
    new `examples.denyListed` (read-prefixed, deny-only) and
    `examples.tokenizer` vectors.
  - `probe-queue` (`$defs`): the Queue.lua JSON.
  - byte caps enforced by the schemas: request ≤ 4 KiB, result item ≤ 3 KiB,
    result ≤ 64 KiB, every response body ≤ 16 KiB; `probe-detail` pages by item.
  - log redaction is case-insensitive.
  - `APPLY:` probe-detail pages by result item and caps each item at 3 KiB
    (the addon truncates) rather than adding a per-call page shape —
    reversible: raising a cap is additive.
  - `APPLY:` the request cap is 4 KiB of serialised output (≈30 full 128-char
    args) rather than lower per-field limits — reversible the same way.
  - `APPLY:` the 4 KiB request cap is measured on the request's largest
    derived form (output form + `probeId`, `flavor` padded to 34 chars) on
    POST, queue entry and echo alike, rather than giving the queue entry and
    echo extra headroom — one number, and any accepted POST fits Queue.lua and
    the probe-detail echo by construction. The echo carries the resolved
    flavor (never `auto`). Worst-case probe-detail page: 14,132 B. Reversible:
    raising the cap or switching to headroom is additive.
  - `APPLY:` the Queue.lua JSON is an object `{ queueVersion, probes }`
    (not a bare array) so the addon can detect a shape change; entries are
    output form with `flavor` resolved.

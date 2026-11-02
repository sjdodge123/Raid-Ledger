# Companion dev-bridge — changelog

Additive changes (a new optional field a reader may ignore, relaxing a
refinement, removing a deny word) stay in `v1/`. Anything else is breaking and
gets a new `vN/` folder; rl-companion accepts the current and previous version
during the transition.

## v1 — 2026-11-02 (ROK-2055)

- Initial contract: the `/dev/v1/*` response bodies of the rl-companion dev
  bridge (health, addons, LedgerLink SavedVariables raw + parsed, probes,
  logs, collectors, errors), the probe grammar (`probe-request`) and the probe
  result the LedgerLinkProbe addon stores (`probe-result`).
- `allowlist.json`: the read-verb allowlist + deny list both rl-companion and
  LedgerLinkProbe apply, with shared example vectors.
- Generated `schema.json` (one `$defs` entry per body), golden fixtures and
  `fixtures/invalid/EXPECTED.json`.

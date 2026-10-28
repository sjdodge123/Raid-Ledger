# Companion device-link — changelog

Additive changes (a new optional field the app may ignore) stay in `v1/`.
Anything else is breaking and gets a new `vN/` folder; the server accepts the
current and previous version during the transition.

## v1 — 2026-10-26 (ROK-1955)

- Initial contract: `POST /companion/v1/devices/link` (start),
  `POST /companion/v1/devices/link/poll`, `GET /companion/v1/device`.
- `verificationUriComplete` carries the user code in the URL **fragment**
  (`/link#code=XXXX-XXXX`), never the query string.
- Generated `schema.json` (one `$defs` entry per body), golden fixtures and
  `invalid/EXPECTED.json`.

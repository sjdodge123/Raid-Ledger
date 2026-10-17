---
name: rl-implement
description: "Implement a feature from spec using TDD: contract, backend, frontend"
---

Delegate to the devedup-rl plugin implement skill:

Run `/devedup-rl:implement` with the user's request.

**Design system:** if the request touches UI, embed in your prompt to the subagent: read
`docs/design-system.md` before any UI change; reuse the `web/src/components/ui` inventory (§3) instead of
a parallel implementation; tokens only, never a raw slate/hex; verify `default-dark` AND `default-light`.
Adding or changing a token, primitive, shared component or pattern updates that doc (+
`docs/design-system-tokens.md` for tokens, + `/dev/design-system`) in the same branch.

---
name: rl-review
description: "Code review: correctness, security, performance, contract integrity"
---

Delegate to the devedup-rl plugin review skill:

Run `/devedup-rl:review` with the user's request.

**Design system:** if the diff touches UI, embed in your prompt to the subagent: check new UI reuses
`docs/design-system.md` inventory primitives and tokens (never a hardcoded colour); flag a new
primitive/pattern with no doc update as MINOR, and a hardcoded colour as MAJOR.

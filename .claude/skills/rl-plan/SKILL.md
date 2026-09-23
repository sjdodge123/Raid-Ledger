---
name: rl-plan
description: "Plan a Raid-Ledger feature: reads docs, identifies workspaces & contract changes, produces milestones"
---

Delegate to the devedup-rl plugin plan skill:

Run `/devedup-rl:plan` with the user's request.

**Design system:** if the plan touches UI, embed in your prompt to the subagent: cite the
`docs/design-system.md` sections/components each milestone reuses, and list any new pattern explicitly.

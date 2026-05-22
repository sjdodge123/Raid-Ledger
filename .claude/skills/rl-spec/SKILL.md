---
name: rl-spec
description: "Write a technical spec: contract schemas, NestJS modules, React components"
---

Delegate to the devedup-rl plugin spec skill, but override the output path.

Run `/devedup-rl:spec` with the user's request. **In your prompt to the subagent, explicitly instruct it to save the spec to `planning-artifacts/specs/ROK-XXX.md` (uppercase `ROK`, ID-only filename — e.g. `ROK-1339.md`) instead of the plugin's default `docs/specs/<feature-name>.md` path.**

The path override is critical: the `/build` skill discovers specs at `planning-artifacts/specs/ROK-XXX.md` (see `.claude/skills/build/SKILL.md:9` and step-1-setup.md:105). Writing to `docs/specs/` makes `/build` treat the story as "requirements not gathered" and regenerate a spec from scratch, losing every design decision made during `/rl-spec`.

The plugin runs `context: fork`, so the override must be embedded in the prompt you pass — it cannot be applied after the fact from this skill's frame.

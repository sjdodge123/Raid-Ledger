# Reference designs before coding — full rules

> **Moved verbatim from `CLAUDE.md` on 2026-11-24 (ROK-2307)** to keep the always-loaded
> instructions small. CLAUDE.md keeps each rule's binding statement and points here; the text
> below is the full original rule, unchanged apart from heading levels. Change both together.

### Reference designs before coding (STRICT — applies to ALL agents)

Before writing implementation code for any feature/fix that **adds, relocates, or restructures UI or introduces a new user-facing flow**, scan for design references that may already exist. (In-place cosmetic tweaks — color, copy, spacing, a single prop on an existing element — are **exempt**.) The operator regularly approves simplified-flow targets, wireframes or design specs ahead of implementation — follow-up work should be **implementing the approved target, not redesigning it**.

**STRICT — read `docs/design-system.md` first.** It is the derived-from-what-ships reference: the `--color-*` tokens, the type/radius/spacing/motion idioms, an inventory of every `web/src/components/ui` primitive plus the de-facto shared components outside it, and DO/DON'T pattern rules. Token tables: `docs/design-system-tokens.md`. Rendered companion: `/dev/design-system` (DEMO_MODE) — its scheme switcher and light/dark side-by-side view are how you check both colour families. Three rules follow:

1. **Reuse a primitive from the inventory, and verify it in both light and dark.** Don't build a parallel one because the existing file is inconvenient to import. "Works" means `default-dark` AND `default-light`; one family checked is not done.
2. **A new pattern needs an explicit line in the PR description:** `New pattern: <what> — <why nothing in the inventory fits>`. Silent invention is the failure this stops (canonical case, ROK-1659: `/games`, Common Ground and Calendar all use the shared `filter-entry.tsx` funnel standard — a toolbar trigger + inline panel at ≥1024px, a neutral Filters FAB + `BottomSheet` below it — instead of three bespoke filter bars).
3. **Never hardcode a colour.** Fifteen themes remap the tokens; a raw slate or hex is a bug in fourteen of them.
4. **Keep the doc current.** Adding/changing a token, primitive, shared component or pattern updates `docs/design-system.md` (+ `docs/design-system-tokens.md` for tokens, + `/dev/design-system`) in the SAME PR — see that doc's "Keeping this doc current" section. Reviewers flag a miss as MINOR.

**Check `planning-artifacts/specs/ROK-XXXX.md` for the story you are building — if it exists it is the APPROVED TARGET, not a starting point.** Uppercase, ID-only filename; never `docs/specs/`. Look up your own story id; do NOT browse that directory — most of its 200+ files are months old and a stale one reads as authoritative. Design artifact mirrors of approved claude.ai sheets: `planning-artifacts/design-*`. Both are gitignored, so they exist only in the local checkout — a spec that matters to another machine belongs in the Linear issue body too.

Where designs live: **spike outputs** (`docs/spikes/*.md` and DEMO_MODE-gated routes under `web/src/dev/**`); **the Linear issue body** — read the WHOLE description, operators link Figma/wireframe/audit URLs inline; **operator memory** (`reference_*.md`); **existing components/pages** solving a similar problem.

If you can't find a reference and the UX direction matters, **ask the operator before coding**. Implementations of the wrong target cost more to undo than asking up front.

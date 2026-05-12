---
name: tldr
description: "Too Long; Didn't Read — compress the previous agent response into a fixed 4-line headline + action format. Invoke when an agent just returned an essay and the operator wants only the headline and what's needed from them."
argument-hint: "[optional: which response to summarize, e.g. 'the reviewer report' — defaults to most recent]"
---

# TL;DR — Compress the Previous Response

The operator just received a long response (often an essay-length report from a subagent, planner, reviewer, or status sweep) and wants the headline + what's needed from them, nothing else.

## What to summarize

Default target: the **most recent substantive output** in the conversation — the last thing an agent (or the main assistant) told the operator before they typed `/tldr`.

If the operator passes an argument (e.g. `/tldr the reviewer report`, `/tldr the build summary`), find that specific output and summarize it instead.

If the previous message was already short (under ~6 lines), reply `Already concise — nothing to compress.` and stop. Don't pad.

## Output format (STRICT — same shape every time)

Output exactly these four sections, in this order, with these labels. Consistency is the entire point — the operator scans for the same fields in the same place every invocation.

```
**TL;DR:** <one-sentence headline — what happened or what the response is about>

**Needs from you:** <the single concrete thing the operator must do next, OR `none` if no action is required>

**Key points:**
- <bullet 1 — most important fact>
- <bullet 2 — second most important>
- <bullet 3 — only if genuinely needed; cap at 3>

**Skip-safe:** <one phrase describing what was in the long response that the operator can safely ignore, OR `n/a` if everything mattered>
```

## Rules

- **One sentence per field.** No paragraphs. No nested bullets. No headers beyond the four labels above.
- **Max 3 key-point bullets.** If you're tempted to add a fourth, the response wasn't actually a TL;DR — pick the top 3.
- **Lead with the verdict, not the process.** "Migration is safe to ship" beats "After reviewing the migration, I checked locking behavior and..."
- **`Needs from you` is the load-bearing field.** If the operator only reads one line, that's the line. Be concrete: "Approve the rebase plan" / "Pick option A or B" / `none`.
- **Preserve numbers and identifiers verbatim.** PR numbers, story IDs (ROK-XXXX), file paths, error counts — don't paraphrase these.
- **No emojis, no decorative markdown, no closing summary sentence.** The four sections ARE the whole output.
- **Do not re-do the work** described in the long response. Just compress what was said. If the original was wrong, that's for `/validate`, not `/tldr`.

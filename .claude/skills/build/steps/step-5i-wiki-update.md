# Step 5i: Wiki Update — Sync Wiki Pages After feat: Story Ships

**Best-effort, non-blocking.** If any step fails, log a warning and continue. Wiki sync failures must NEVER fail the pipeline.

---

## Trigger Criteria

Only run this step when:
- The shipped story title starts with `feat:`
- The story's domain maps to a wiki page (see mapping below)

Skip if:
- Story is `fix:`, `tech-debt:`, `chore:`, or `perf:`
- No wiki page maps to the story's domain

---

## Domain-to-Wiki-Page Mapping

| Domain | Wiki Page |
|--------|-----------|
| Events | `Events-and-Scheduling.md` |
| Roster | `Roster-Management.md` |
| Discord | `Discord-Bot-Setup.md` |
| Voice / Ad-Hoc | `Ad-Hoc-Voice-Events.md` |
| Games / IGDB | `Game-Library-and-IGDB.md` |
| Analytics | `Analytics-and-Metrics.md` |
| Notifications | `Notifications-and-Reminders.md` |
| Plugins | `Plugin-System.md` |
| Auth | `Authentication.md` |
| Bindings | `Channel-Bindings.md` |
| Admin / Config | `Configuration-Reference.md` |
| Backup | `Backup-and-Recovery.md` |
| Deploy / Docker | `Updating.md` |

**How to determine the domain:** Look at the story title, description, and which modules the PR touched. Match to the most relevant domain above.

---

## Procedure

### 1. Clone the Wiki Repo

```bash
WIKI_DIR=$(mktemp -d)
GH_TOKEN=$(gh auth token)
git clone "https://${GH_TOKEN}@github.com/sjdodge123/Raid-Ledger.wiki.git" "$WIKI_DIR"
```

If the clone fails (wiki not yet enabled, auth issue), log a warning and skip.

### 2. Update the Relevant Wiki Page

Read the target wiki page from `$WIKI_DIR/<page>.md`. Update it with information about the new feature:

- Add a new section or update an existing section
- Source content from the actual code changes in the PR
- Keep the page style consistent with existing content
- Do NOT remove existing content — only add or update

If the page doesn't exist in the wiki yet, copy it from the `wiki/` directory in the repo root.

### 3. Commit and Push

```bash
cd "$WIKI_DIR"
git add -A
git commit -m "docs: update <page> for ROK-<num>" || true  # no-op if nothing changed
git push origin master 2>/dev/null || git push origin main 2>/dev/null || echo "WARN: Wiki push failed — skipping"
```

### 4. Cleanup

```bash
rm -rf "$WIKI_DIR"
```

---

## Error Handling

- **Clone fails:** Log "WARN: Could not clone wiki repo — skipping wiki update" and continue
- **Push fails:** Log "WARN: Wiki push failed — skipping" and continue
- **No matching domain:** Log "INFO: No wiki page maps to this story's domain — skipping" and continue
- **Any other error:** Log the error and continue

**The pipeline must never fail because of a wiki sync issue.**

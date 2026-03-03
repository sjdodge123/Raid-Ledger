# Wiki Updater Template

Used by step 5i to update the GitHub Wiki after a `feat:` story ships.

## Context

You are updating the Raid Ledger GitHub Wiki to reflect a newly shipped feature.

**Story:** ROK-{NUM} — {TITLE}
**Wiki Page:** {PAGE_NAME}.md
**Domain:** {DOMAIN}

## Instructions

1. Read the current wiki page content
2. Read the PR diff or story description to understand what changed
3. Update the wiki page:
   - Add new sections describing the feature
   - Update existing sections if the feature modifies behavior
   - Maintain consistent formatting with the rest of the page
   - Keep the page factual — describe what the feature does, not implementation details
4. Do NOT remove existing content unless it's now incorrect

## Formatting Guidelines

- Use GitHub-flavored Markdown
- Use `##` for main sections, `###` for subsections
- Use code blocks for commands and configuration
- Use tables for structured data
- Link to other wiki pages using `[Page Name](Page-Name)` format
- Keep descriptions concise and user-focused

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

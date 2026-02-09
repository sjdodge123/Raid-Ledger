---
name: backup
description: Sync project state to Linear and back up images + secrets to NAS (or Desktop fallback)
allowed-tools: "Bash(zip *), Bash(ls *), Bash(mount *), Bash(mkdir *), Bash(cp *), Bash(rm /tmp/raid-ledger-*), Bash(open *), Bash(date *), Bash(wc *), Bash(du *), mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__create_issue, mcp__linear__list_documents, mcp__linear__create_document, mcp__linear__update_document, Read, Glob, Grep"
---

# Backup Skill

Back up all critical gitignored project state to Linear (text) and NAS/Desktop (images + secrets).

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

## Step 1: Sync Sprint Status to Linear

Read `planning-artifacts/sprint-status.yaml` as the source of truth.

For each story entry:
1. Look up the matching Linear issue by **identifier** (e.g., ROK-171)
2. Map the local status to a Linear status:
   | Local Status | Linear Status |
   |---|---|
   | `done` | Done |
   | `ready-for-dev` | Todo |
   | `in-progress` | In Progress |
   | `review` | In Review |
   | `backlog` | Backlog |
   | `deprecated` | Canceled |
   | `deferred` | Backlog |
3. If the Linear issue status doesn't match, update it
4. If no Linear issue exists for a story, create one with the correct status

Track counts: updated, created, already-correct, errors.

## Step 2: Build Linear Document

Create or update a Linear document titled **"Raid Ledger — Project Backup"** in the Raid Ledger project.

The document contains a **sprint status snapshot** plus git state for quick reference. The full text backup goes to NAS (Step 3b).

### Document content:
```
# Raid Ledger Project Backup
**Generated:** <timestamp>
**Git Branch:** <current branch>
**Git SHA:** <short hash>
**Git Status:** <clean/dirty + summary of changes>

## Sprint Status
<full contents of planning-artifacts/sprint-status.yaml in a yaml code block>
```

### How to create/update:
1. Use `mcp__linear__list_documents` with `query: "Raid Ledger — Project Backup"` to check if document exists
2. If it exists, use `mcp__linear__update_document` with the existing document ID
3. If not, use `mcp__linear__create_document` with `project: "Raid Ledger"`

## Step 3a: Back Up Images + Secrets ZIP

Create: `raid-ledger-backup-<YYYY-MM-DD>.zip`

**Contents:**
- All images/media from `implementation-artifacts/` and `planning-artifacts/` (*.png, *.jpg, *.jpeg, *.gif, *.webp, *.svg, *.mp4, *.mov, *.webm)
- `.env`, `.env.docker`, `api/.env` (if exists)

```bash
cd /Users/sdodge/Documents/Projects/Raid-Ledger
zip -r /tmp/raid-ledger-backup-$(date +%Y-%m-%d).zip \
  .env .env.docker api/.env \
  $(find implementation-artifacts/ planning-artifacts/ -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.webp" -o -name "*.svg" -o -name "*.mp4" -o -name "*.mov" -o -name "*.webm" \)) \
  2>/dev/null
```

## Step 3b: Back Up Text Files ZIP

Create: `raid-ledger-text-backup-<YYYY-MM-DD>.zip`

**Contents** (all critical gitignored text files):
- `CLAUDE.md`
- `.claude/skills/` (all skill SKILL.md files)
- `.claude/settings.local.json`
- `project-context.md`, `task.md`, `walkthrough.md`, `implementation_plan.md`
- `planning-artifacts/sprint-status.yaml`, `planning-artifacts/council-decisions.md`, `planning-artifacts/epics.md`
- `.agent/workflows/backup.md`, `handover.md`, `verify-ui.md`, `council-meeting.md`
- `scripts/*.py`, `scripts/*.sh`

```bash
zip -r /tmp/raid-ledger-text-backup-$(date +%Y-%m-%d).zip \
  CLAUDE.md .claude/skills/ .claude/settings.local.json \
  project-context.md task.md walkthrough.md implementation_plan.md \
  planning-artifacts/sprint-status.yaml planning-artifacts/council-decisions.md planning-artifacts/epics.md \
  .agent/workflows/backup.md .agent/workflows/handover.md .agent/workflows/verify-ui.md .agent/workflows/council-meeting.md \
  scripts/*.py scripts/*.sh \
  2>/dev/null
```

## Step 3c: Copy to NAS (or Desktop fallback)

**Primary — NAS:**
1. Check if NAS is mounted: `mount | grep -q "Asura._afpovertcp._tcp.local/Backup"`
2. If mounted, verify path exists: `ls /Volumes/Backup/sdodge/Raid-Ledger/`
3. Copy both ZIPs: `cp /tmp/raid-ledger-*-$(date +%Y-%m-%d).zip /Volumes/Backup/sdodge/Raid-Ledger/`

**Fallback — Desktop:**
1. If NAS is not reachable, copy to: `~/Desktop/`
2. Note in summary that NAS was unavailable

Clean up: `rm /tmp/raid-ledger-*-$(date +%Y-%m-%d).zip`

## Step 4: Print Summary

Print a clear summary:

```
=== Backup Complete ===

Linear Status Sync:
  - Updated: X issues
  - Created: X issues
  - Already correct: X issues
  - Errors: X

Linear Document:
  - Document: "Raid Ledger — Project Backup" (created/updated)
  - Content: Sprint status + git state

NAS/Desktop Backup:
  - Images ZIP: raid-ledger-backup-YYYY-MM-DD.zip (X MB, Y images, Z env files)
  - Text ZIP: raid-ledger-text-backup-YYYY-MM-DD.zip (X KB, Y files)
  - Destination: NAS (/Volumes/Backup/sdodge/Raid-Ledger/) | Desktop (~/Desktop/)

Timestamp: <ISO timestamp>
```

---
name: create-prd
description: PRD lifecycle management — Create, Validate, or Edit comprehensive Product Requirements Documents
disable-model-invocation: true
argument-hint: "[-c create | -v validate | -e edit]"
---

# Create PRD

Launch the BMAD PRD workflow for Product Requirements Document lifecycle management.

Read and follow the workflow instructions at:
`{project-root}/_bmad/bmm/workflows/2-plan-workflows/create-prd/workflow.md`

If `$ARGUMENTS` contains a mode flag (-c, -v, -e), use it to skip mode selection. Otherwise the workflow will prompt for mode.

Modes:
- **Create** (-c) — Create a new PRD from scratch
- **Validate** (-v) — Validate an existing PRD against BMAD standards
- **Edit** (-e) — Improve an existing PRD

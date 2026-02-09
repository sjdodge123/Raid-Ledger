---
name: testarch-trace
description: Generate requirements-to-tests traceability matrix with coverage analysis and quality gate decisions
disable-model-invocation: true
argument-hint: "[-c create | -v validate | -e edit]"
---

# Test Architecture Traceability

Launch the BMAD Test Architecture Trace workflow for requirements traceability.

Read and follow the workflow instructions at:
`{project-root}/_bmad/tea/workflows/testarch/trace/workflow.md`

If `$ARGUMENTS` contains a mode flag (-c, -v, -e), use it to skip mode selection. Otherwise the workflow will prompt for mode.

Modes:
- **Create** — Generate a new traceability matrix
- **Validate** — Validate existing outputs against checklist
- **Edit** — Revise existing traceability outputs

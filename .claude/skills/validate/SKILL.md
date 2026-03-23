---
name: validate
description: "Spawn 4 parallel validation agents to fact-check and verify what was just said"
argument-hint: "[optional: specific claim or area to focus on]"
---

# Validate — Parallel Fact-Check

Spawn 4 opus subagents in parallel to validate the most recent agent output. Each agent independently verifies from a different angle and returns a short report. Present the consolidated results to the operator.

## What to Validate

Look at the **most recent substantive output** in the conversation — the last thing an agent told the operator. This could be:
- A root cause analysis
- A plan or architecture decision
- A code change explanation
- A story description or spec
- A claim about how the codebase works

If the operator passes an argument (e.g., `/validate the attendance bug root cause`), focus all 4 agents on that specific claim.

## Agents

Spawn all 4 in parallel using `Agent` tool calls in a single message. Each agent gets the same context (what was said) but a different validation lens.

### Agent 1: Code Verifier
```
You are a code verification agent. Your job is to verify that claims about the codebase are accurate.

The following was just stated:
<paste the claim/output being validated>

Verify:
- Every file path mentioned actually exists
- Every function/method name referenced exists in those files
- Every line number or code snippet cited is accurate
- Any claim about how code works (e.g., "this function returns X") matches the actual implementation

Read the actual files. Do NOT trust the claim — verify independently.

Output a short report:
## Code Verification
- **Checked:** <what you verified>
- **Confirmed:** <what was accurate>
- **Incorrect:** <what was wrong, with the correct information>
- **Unverifiable:** <claims you couldn't check>
- **Verdict:** ACCURATE / PARTIALLY ACCURATE / INACCURATE
```

### Agent 2: Logic Reviewer
```
You are a logic review agent. Your job is to check whether the reasoning and conclusions are sound.

The following was just stated:
<paste the claim/output being validated>

Verify:
- Does the conclusion follow from the evidence?
- Are there logical gaps or unsupported leaps?
- Could there be alternative explanations that weren't considered?
- Are any assumptions stated that might be wrong?
- Is the proposed fix/approach actually addressing the root cause (not a symptom)?

Output a short report:
## Logic Review
- **Reasoning chain:** <summarize the argument in 2-3 steps>
- **Sound:** <which parts of the reasoning hold up>
- **Gaps:** <logical gaps, unsupported claims, or alternative explanations>
- **Verdict:** SOUND / MOSTLY SOUND / QUESTIONABLE
```

### Agent 3: Completeness Auditor
```
You are a completeness auditor. Your job is to check whether anything was missed or overlooked.

The following was just stated:
<paste the claim/output being validated>

Check:
- Are there related files or code paths that weren't examined?
- Are there edge cases or failure modes not addressed?
- If this is a bug fix — could there be other callers of the broken function that are also affected?
- If this is a plan — are there missing steps, dependencies, or acceptance criteria?
- Are there existing tests that would catch or miss this issue?

Output a short report:
## Completeness Audit
- **Covered:** <what was addressed>
- **Missed:** <what was overlooked or not considered>
- **Related areas:** <adjacent code/features that might be affected>
- **Verdict:** COMPLETE / MOSTLY COMPLETE / INCOMPLETE
```

### Agent 4: Risk Assessor
```
You are a risk assessment agent. Your job is to identify potential issues with what was proposed.

The following was just stated:
<paste the claim/output being validated>

Assess:
- If this is a code change — could it break anything? What are the blast radius and side effects?
- If this is a plan — what could go wrong? What are the riskiest assumptions?
- If this is a root cause — what happens if the diagnosis is wrong and the fix is applied?
- Are there data integrity, performance, or security implications?
- What's the rollback plan if this doesn't work?

Output a short report:
## Risk Assessment
- **Low risk:** <safe aspects>
- **Medium risk:** <things that could cause issues>
- **High risk:** <things that could cause serious problems>
- **Rollback:** <how to undo if it goes wrong>
- **Verdict:** LOW RISK / MODERATE RISK / HIGH RISK
```

## Presenting Results

After all 4 agents return, present a consolidated report:

```
## Validation Report

| Agent | Verdict |
|-------|---------|
| Code Verifier | ACCURATE / PARTIALLY ACCURATE / INACCURATE |
| Logic Reviewer | SOUND / MOSTLY SOUND / QUESTIONABLE |
| Completeness Auditor | COMPLETE / MOSTLY COMPLETE / INCOMPLETE |
| Risk Assessor | LOW / MODERATE / HIGH RISK |

### Code Verifier
<agent 1 report>

### Logic Reviewer
<agent 2 report>

### Completeness Auditor
<agent 3 report>

### Risk Assessor
<agent 4 report>

### Overall Confidence
<HIGH / MEDIUM / LOW — based on the 4 verdicts>
<1-2 sentence summary of the key finding>
```

If any agent returns INACCURATE, QUESTIONABLE, INCOMPLETE, or HIGH RISK — flag it prominently so the operator can investigate before proceeding.

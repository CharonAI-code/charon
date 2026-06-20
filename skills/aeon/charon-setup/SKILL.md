---
name: charon-setup
category: dev
description: Install and verify Charon enforcement in an AEON repo without requiring the operator to run terminal commands
var: ""
tags: [security, aeon, policy, github-actions]
requires: []
mcp: []
commits: true
permissions:
  - contents:write
  - workflows:write
---

> **${var}** — Optional setup mode. Use `status` to inspect only, `install` to install or repair Charon, or `test` to run enforcement probes after setup. Empty means `install`.

Today is ${today}. Your task is to make Charon active in this AEON repo, verify that enforcement is wired before the agent launch, and report the result to the operator. The operator should not need to run commands manually.

## What Charon Adds

Charon is a policy gate for AEON GitHub Actions runs.

The intended flow:

1. AEON receives a task.
2. Charon normalizes the requested skill, trigger, repo, user variable, and intent into policy resources.
3. `charon.aeon.yml` returns `PASS`, `PAUSE`, or `DENY`.
4. `PASS` continues to AEON.
5. `PAUSE` creates a review with Telegram approval.
6. `DENY` stops before Claude or side effects launch.
7. Receipts are written under `.charon/receipts`.

## Steps

### 1. Parse Mode

Interpret the operator value using these modes:

- empty, `install`, `setup`, `enable`, `repair` → `MODE=install`
- `status`, `check`, `verify` → `MODE=status`
- `test`, `smoke` → `MODE=test`

Anything else is still `MODE=install`; treat the text as operator intent, not as shell input.

### 2. Run The Setup Helper

Run the bundled helper from the repo root:

```bash
bash skills/charon-setup/scripts/setup_charon_aeon.sh "$MODE"
```

Read the JSON printed by the helper. Do not reimplement the helper in the prompt.

The helper:

- verifies this is an AEON repo
- runs `charon enforce aeon`
- checks `charon enforce aeon status`
- runs `charon aeon smoke`
- stages and commits Charon setup files when changed
- pushes when the repo allows it

### 3. Success Response

If `status` is `ok`, reply with:

```text
Charon is enabled for this AEON repo.

status: AEON ENFORCED
smoke: AEON MVP SMOKE PASS

changed:
- .github/workflows/aeon.yml
- charon.aeon.yml

policy:
- PASS by default
- PAUSE for approval-worthy skills
- DENY for repo wipe / secret exfil / high-confidence no-go side effects
```

If the helper says `committed` or `pushed`, include that fact.

### 4. Blocked Response

If `status` is `blocked`, report the blocker exactly. Do not invent recovery steps.

Common blockers:

- `.github/workflows/aeon.yml` missing
- `aeon.yml` missing
- workflow write permission missing
- push permission missing

### 5. Failed Response

If `status` is `failed`, include the last error from the JSON and stop.

Do not claim Charon is enabled unless the helper reports `ok`.

## Exit Taxonomy

- `CHARON_SETUP_OK` — setup/status/test succeeded.
- `CHARON_SETUP_NOT_AEON` — required AEON files are missing.
- `CHARON_SETUP_ENFORCE_FAILED` — Charon could not patch or validate the workflow.
- `CHARON_SETUP_SMOKE_FAILED` — Charon patched the repo but probes did not pass.
- `CHARON_SETUP_PUSH_BLOCKED` — local commit succeeded but push failed.

## Safety

Never ask the operator to run a command.

Never paste secret values.

Never weaken `charon.aeon.yml` during setup. Policy changes belong to the `charon-policy` skill.

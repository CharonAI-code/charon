---
name: charon-policy
category: security
description: Inspect, explain, test, and safely edit charon.aeon.yml policy from natural language
var: ""
tags: [security, aeon, policy, governance]
requires: []
mcp: []
commits: true
permissions:
  - contents:write
  - workflows:read
---

> **${var}** — Policy request. Examples: `status`, `test`, `explain`, `make repo-actions pass`, `pause deploy-prototype`, `deny secret exfil and repo wipe`. Empty means `status`.

Today is ${today}. Your task is to help the operator manage `charon.aeon.yml` without making them edit YAML manually.

## Policy Model

Use this mental model:

- `PASS` — normal read, research, analysis, status, summaries.
- `PAUSE` — legitimate but approval-worthy actions. The user can approve after seeing a plan.
- `DENY` — high-confidence no-go side effects. No approval path.

Default policy should stay:

```text
defaultVerdict: PASS
DENY first
PAUSE second
PASS default last
```

## Steps

### 1. Read Current Policy

Open `charon.aeon.yml`.

If missing, tell the user to run `charon-setup` first. Do not create a policy from scratch in this skill unless the user explicitly asks for bootstrap.

### 2. Parse The Operator Request

Normalize `${var}`:

- empty, `status`, `explain` → explain current policy
- `test`, `verify`, `smoke` → run probes only
- natural-language change request → propose a policy diff first

Examples:

- “make repo-actions pass” weakens policy.
- “pause repo-actions” keeps/strengthens supervision.
- “deny webhook exfil” strengthens policy.
- “allow deploy without approval” weakens policy.

### 3. Apply Safe Change Rules

Hardening changes may be applied directly:

- add DENY for high-confidence no-go side effects
- add PAUSE for write-capable skills
- rename rules for clarity without changing verdicts

Weakening changes require a proposed plan before edit:

- DENY → PAUSE
- DENY → PASS
- PAUSE → PASS
- removing exfil / repo-wipe / workflow-security controls

If the request weakens policy, respond with:

```text
This weakens Charon policy.

Proposed change:
- ...

Effect:
- PASS:
- PAUSE:
- DENY:

Reply approve to apply.
```

Do not apply the weakening change unless the operator explicitly approves in the same run context.

### 4. Edit Policy

When approved or when hardening is safe, update `charon.aeon.yml`.

Keep rule IDs stable when possible. Use clear IDs:

- `aeon.repo_wipe.deny`
- `aeon.secret_exfil.deny`
- `aeon.repo_actions.pause`
- `aeon.workflow_audit.pause`

Keep DENY rules above PAUSE rules.

### 5. Verify

Run:

```bash
node skills/aeon/charon-policy/scripts/verify_policy.js
```

Read the JSON output.

The helper checks:

- YAML parses
- `defaultVerdict` is `PASS`
- DENY rules appear before PAUSE rules
- repo wipe intent returns DENY
- secret exfil intent returns DENY
- write-capable skill returns PAUSE
- read-only skill returns PASS

If verification fails, do not commit. Restore or fix the policy first.

### 6. Commit

If the policy changed and verification passed:

```bash
git add charon.aeon.yml
git commit -m "Update Charon AEON policy"
git push origin HEAD
```

If push fails, report that the policy was committed locally but not pushed.

## Response Shape

Use this:

```text
Charon policy updated.

verified:
- PASS: read-only skill
- PAUSE: write-capable skill
- DENY: repo wipe
- DENY: secret exfil

changed:
- ...
```

For status-only requests:

```text
Charon policy status:

default: PASS
DENY:
- ...
PAUSE:
- ...
```

## Exit Taxonomy

- `CHARON_POLICY_OK` — policy verified or updated.
- `CHARON_POLICY_MISSING` — `charon.aeon.yml` not found.
- `CHARON_POLICY_WEAKENING_NEEDS_APPROVAL` — request would relax enforcement.
- `CHARON_POLICY_INVALID` — YAML or policy shape invalid.
- `CHARON_POLICY_PROBES_FAILED` — PASS/PAUSE/DENY probes did not match expected behavior.

## Safety

Never paste secrets.

Never remove repo-wipe or secret-exfil DENY rules unless the operator explicitly approves a weakening change.

Never claim policy is active unless verification passes.

---
name: charon-bankr
description: Use Charon policy checks for Bankr wallet, trading, token launch, automation, and external actions before execution.
tags: [bankr, security, policy, wallet, defi]
version: 1
visibility: public
metadata:
  clawdbot:
    emoji: "🛡️"
    homepage: "https://github.com/CharonAI-code/charon"
    requires:
      bins: [node]
---

# Charon Bankr Policy

Use this skill when a Bankr action can move funds, trade assets, launch tokens, create automations, call external APIs, open browser sessions, or expose account data.

This skill does not replace Bankr runtime enforcement. It adds a deterministic policy check before the agent continues.

## Flow

1. Normalize the requested Bankr operation into the action model in `references/action-model.md`.
2. Load the user's policy, or start from `templates/charon.policy.json`.
3. Run `scripts/charon_policy_check.js` with the action and policy.
4. If the verdict is `DENY`, stop.
5. If the verdict is `PAUSE`, ask the user for explicit confirmation before continuing.
6. If the verdict is `PASS`, continue.
7. Run `scripts/charon_receipt.js` and keep the receipt with the conversation or task output.

## Commands

Policy check:

```bash
node scripts/charon_policy_check.js action.json policy.json
```

Receipt:

```bash
node scripts/charon_receipt.js action.json verdict.json
```

## Verdicts

`PASS` means the action can continue.

`PAUSE` means user confirmation is required.

`DENY` means the action must not be executed.

## References

Use `references/action-model.md` for the normalized action shape.

Use `references/policy-format.md` for policy fields and match operators.

Use `references/receipt-format.md` for receipt fields.

Use `references/bankr-controls.md` for default control ideas.

Use `references/examples.md` for runnable examples.

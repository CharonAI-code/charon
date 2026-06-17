---
name: charon-setup
description: >
  Install and verify Charon inside an Aeon agent repo. Use when the user asks
  to set up Charon, enable Charon security, add policy enforcement, wire Charon
  into Aeon, or protect Aeon skills before Claude runs. This skill patches the
  Aeon GitHub Actions workflow, creates charon.aeon.yml, runs the Charon Aeon
  smoke check, commits the setup files, and pushes when the repo allows it.
commits: true
permissions:
  - contents:write
  - workflows:write
---

# Charon Setup For Aeon

Use this skill when the user wants Charon enabled in this Aeon repo.

Trigger phrases:

- set up charon
- install charon
- enable charon
- add charon security
- wire charon into aeon
- protect this aeon repo with charon

## What to do

1. Confirm this is an Aeon repo:
   - `.github/workflows/aeon.yml` must exist.
   - `aeon.yml` should exist.
2. Run the setup script:

```bash
bash skills/aeon/charon-setup/scripts/setup_charon_aeon.sh
```

3. Read the final JSON printed by the script.
4. Reply to the user with the actual result.

## Success reply

Use this shape:

```text
Charon is enabled for this Aeon repo.

Status: AEON ENFORCED
Smoke: AEON MVP SMOKE PASS

Changed:
- .github/workflows/aeon.yml
- charon.aeon.yml
```

If the script committed and pushed, say that.

## Blocked reply

If setup fails, do not improvise. Report the exact blocker from the script.

Common blocker:

```text
GitHub blocked workflow modification. Give this repo workflow write permission, then ask me to set up Charon again.
```

## Important

Do not ask the user to run terminal commands.

The whole point of this skill is that Aeon installs Charon itself from the dashboard or Telegram.

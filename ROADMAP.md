# Charon Roadmap

Charon is moving toward one core product:

> A local security layer for autonomous agents: policy, identity, approvals,
> and verifiable receipts before actions touch the machine.

The first product target is intentionally narrow:

- local-first CLI
- Aeon-first integration
- programmable policy
- signed receipts
- no hosted service required

## Product Shape

The user experience should feel like this:

```bash
charon setup
charon gate -- <agent command>
```

For Aeon:

```bash
charon aeon init
charon aeon enable
```

After that, Aeon actions can be routed through Charon without users manually
remembering a long command flow.

## Phase 1: Local Gate

Goal: put Charon in front of agent actions.

Ship:

- `charon.yml`
- PASS / PAUSE / DENY decisions
- command preflight
- environment scrubbing
- denied file and secret patterns
- local command runner

Done when:

- safe commands execute
- denied commands never launch
- paused commands enter a review queue

## Phase 2: Receipts

Goal: make every decision inspectable.

Ship:

- receipt schema
- policy hash
- command and cwd
- runtime tag
- exposed env names, never values
- denied env names
- start/end time
- exit code
- `charon receipts`
- `charon verify`

Done when:

- every gate action leaves evidence
- secret values are redacted
- tampered receipts fail verification

## Phase 3: Signed Agent Identity

Goal: prove which local agent identity made the request.

Ship:

- local key generation
- identity document
- receipt signatures
- identity verification
- adapter identity fields

Done when:

- receipts can prove they came from the local Charon identity
- identity mismatch is visible during verification

## Phase 4: Aeon Integration

Goal: make Charon useful for Aeon users without extra ceremony.

Ship:

- Aeon repo detection
- skill detection
- `charon aeon init`
- `charon aeon enable`
- skill-tagged receipts
- Aeon wrapper script

Done when:

- Aeon skills can be associated with Charon receipts
- users can enable Charon once per repo
- Charon policy lives beside the Aeon workspace

## Phase 5: Policy UX

Goal: make policy setup less technical.

Ship:

- `charon setup`
- `charon status`
- `charon selftest`
- policy generation from local repo context
- clear queue approval flow
- safer defaults for release, publish, secrets, and destructive commands

Done when:

- a new user can set up Charon in minutes
- status explains what is protected
- selftest proves the local gate works

## Phase 6: Agent Adapters

Goal: make Charon usable outside a single agent runtime.

Ship:

- Aeon adapter
- Codex adapter
- Claude adapter
- stable SDK API
- shared receipt format

Done when:

- adapters can call the same Charon policy engine
- product remains one core security layer, not separate wrappers

## MVP Definition

MVP means:

- `charon setup`
- `charon gate -- <command>`
- `charon aeon init`
- `charon aeon enable`
- PASS / PAUSE / DENY
- signed receipts
- receipt verification
- local queue
- clean public install flow

That is enough to prove Charon as useful agent security infrastructure without
requiring hosted infra, tokens, payments, or a separate runtime dependency.

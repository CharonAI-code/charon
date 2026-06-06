# Charon Roadmap

Charon is moving toward one core product:

> A macOS security runtime for autonomous agents, powered by real sandboxing.

The first product target is intentionally narrow:

- macOS only
- Aeon first
- OpenShell-backed sandboxing from the start

This keeps Charon focused enough to ship while still building on serious
runtime isolation instead of prompt-level guardrails.

## Product Shape

The user experience should feel like this:

```bash
charon init
charon run -- <agent command>
```

For Aeon:

```bash
charon aeon init
charon aeon run <skill>
```

Charon owns the agent-facing UX. OpenShell provides the hardened sandbox
backend.

## Why OpenShell

OpenShell is the strongest starting point because it is already built for
agent sandboxes instead of generic app sandboxing.

Charon should not fork OpenShell or pretend to replace it. Charon should sit
above it as the agent-specific product layer:

- simple agent policy
- Aeon-aware defaults
- OpenShell policy generation
- sandbox launch
- receipts
- verification
- clean developer UX

OpenShell handles the low-level runtime work. Charon makes it usable for Aeon
users and later for other agent runtimes.

## Phase 1: macOS Bootstrap

Goal: make Charon able to detect and prepare a macOS sandbox environment.

Ship:

- macOS-only platform gate
- `charon doctor`
- OpenShell detection
- Docker Desktop detection
- OpenShell gateway status check
- clear install guidance when OpenShell is missing
- clean failure when the machine cannot run the backend

Done when:

- Charon can say whether the current Mac is ready
- missing dependencies produce one obvious next step
- only macOS paths appear in the product flow

## Phase 2: Charon Policy v1

Goal: define the smallest useful policy Charon can compile into OpenShell.

Ship:

- `charon.yml` schema
- file read/write scope
- denied paths
- allowed network hosts
- denied commands
- exposed and denied environment variable names
- strict default policy
- policy validation

Example:

```yaml
sandbox:
  files:
    read:
      - .
    write:
      - reports/**
    deny:
      - .env
      - ~/.ssh/**
      - ~/.aws/**
  network:
    allow:
      - github.com
      - api.github.com
  commands:
    deny:
      - git push
      - npm publish
      - rm -rf
  env:
    expose:
      - GITHUB_TOKEN
    deny:
      - ANTHROPIC_API_KEY
      - CLAUDE_CODE_OAUTH_TOKEN
```

Done when:

- `charon init` writes a useful default policy
- invalid policy fails before execution
- policy never stores secret values
- policy is simple enough for normal builders to edit

## Phase 3: OpenShell Compiler

Goal: turn `charon.yml` into OpenShell runtime configuration.

Ship:

- policy-to-OpenShell renderer
- generated sandbox name
- generated policy hash
- mapped file scopes
- mapped network allowlist
- mapped environment exposure rules
- temporary generated OpenShell config
- `charon compile` for inspection

Done when:

- `charon compile` shows what will be sent to OpenShell
- the generated config is deterministic
- policy hash changes when sandbox-relevant policy changes

## Phase 4: Sandboxed Runner

Goal: run a command through Charon using OpenShell on macOS.

Ship:

- `charon run -- <command>`
- OpenShell sandbox creation
- command launch inside sandbox
- env scrubbing before launch
- blocked command preflight for obvious irreversible actions
- exit code propagation
- local receipt for every run

Done when:

- allowed commands run inside OpenShell
- denied paths are not reachable from the sandbox
- denied network targets are blocked by the sandbox policy
- receipts show backend, command, policy hash, start/end time, and exit code

## Phase 5: Aeon Local Product

Goal: make Aeon the first native Charon use case.

Ship:

- `charon aeon init`
- Aeon repo detection
- Aeon skill detection
- skill-aware default policy
- `charon aeon run <skill>`
- receipts tagged with Aeon skill name
- clean migration from existing Charon Aeon guardrails to sandbox mode

Done when:

- an Aeon skill can run locally on macOS through OpenShell
- common sensitive paths are blocked
- the receipt clearly says which Aeon skill ran
- the user does not need to understand OpenShell commands

## Phase 6: Receipts and Verify

Goal: make every sandboxed agent run inspectable.

Ship:

- receipt schema v1
- policy hash
- backend name and version
- generated sandbox/config hash
- command and cwd
- exposed env names, never values
- denied env names
- start/end time
- exit code
- `charon receipts`
- `charon verify <receipt>`

Done when:

- receipts are useful without being noisy
- no secret values are stored
- tampered receipts fail verification

## Phase 7: Public MVP

Goal: ship a clean public product.

Ship:

- one root CLI package
- public README focused on macOS + Aeon
- no internal phase/test commands in public docs
- install path that works from a fresh machine
- demo script that proves denied file/network behavior

Done when:

- a new macOS user can run Charon from the README
- Aeon users understand why Charon exists in under a minute
- the demo shows real sandbox containment
- the repo looks like a product, not a build log

## MVP Definition

MVP means:

- macOS only
- OpenShell backend
- `charon init`
- `charon doctor`
- `charon run -- <command>`
- `charon aeon init`
- `charon aeon run <skill>`
- receipts
- clean public docs

That is enough to prove Charon as a real sandbox product for autonomous
agents.

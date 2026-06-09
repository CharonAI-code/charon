# Charon

Pre-execution policy enforcement for agent actions.

Charon receives an attempted action as typed data, evaluates it against local
policy, and returns one of three decisions before execution:

```txt
PASS  -> execute
PAUSE -> queue for review
DENY  -> block before launch
```

Every decision writes a verifiable receipt.

## Install

```bash
npx github:CharonAI-code/charon setup
```

For local development:

```bash
npm install
npm link
```

## Quick Start

```bash
charon init
charon run -- echo "hello"
charon run -- cat .env
charon run -- git push
```

Expected behavior:

```txt
echo      -> PASS
cat .env  -> DENY
git push  -> PAUSE
```

Review paused actions:

```bash
charon queue
charon approve <id>
charon reject <id>
```

Inspect proof:

```bash
charon receipts latest
charon trace latest
charon verify latest
```

## MCP Proxy

Run an MCP server behind Charon:

```bash
charon mcp proxy -- <mcp-server-command>
```

The proxy passes normal MCP traffic through, intercepts `tools/call`, evaluates
the requested tool call as a typed Charon action, and only forwards it to the
upstream MCP server on `PASS`.

`DENY` and `PAUSE` return an MCP tool error result and write a receipt.

## What Charon Enforces

Charon evaluates actions before they reach the machine:

- shell commands
- file reads and writes
- secret-looking values
- network URLs
- git remotes
- MCP-style tool calls
- destructive or release actions

The CLI keeps the older shell-command detector for compatibility, so chained
commands, package scripts, env-expanded URLs, and `.env` path variants are still
caught while new decisions are written as typed receipts.

## Receipt v2

New receipts use `charon.trustedReceipt.v2` and include:

- typed action
- policy decision
- redacted resources
- policy hash
- action hash
- decision hash
- receipt hash
- optional Ed25519 signature
- execution status

Secrets are redacted before receipts and enforcement audit records are stored.

## SDK

```js
const { createCharon } = require("charon");

const charon = createCharon({ cwd: process.cwd() });

const decision = await charon.enforce({
  runtime: "agent",
  toolName: "filesystem.read",
  args: { path: ".env" },
}, async () => {
  // only runs when Charon returns PASS
});
```

## Policy

`charon init` creates `charon.yml`.

Policy supports command bounds and typed resource rules:

```yaml
version: 1
bounds:
  pass:
    - echo
    - npm test
  pause:
    - git push
  deny:
    - npm publish
    - rm -rf
    - read:.env
  rules:
    - id: secrets.env
      verdict: DENY
      role: secret
```

## Commands

```bash
charon init
charon setup
charon doctor
charon selftest
charon run -- <command>
charon gate -- <command>
charon queue
charon approve <id>
charon reject <id>
charon receipts [list|latest|inspect <id|latest>]
charon trace <id|latest>
charon verify <receipt|latest>
charon mcp proxy -- <mcp-server-command>
charon status
```

`charon gate` and `charon run` are equivalent.

## Scope

Current MVP:

- local-first
- no hosted service
- no token
- no payment layer
- typed pre-execution policy
- local review queue
- verifiable receipts

Legacy runtime-specific experiments are kept out of the main flow.

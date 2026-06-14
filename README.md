# Charon

Runtime security for agent actions.

Charon sits between an agent runtime and the actions it wants to take. Every
shell command, file operation, network request, or MCP tool call is normalized
into typed data, evaluated against local policy, and handled before anything
risky reaches the machine.

```txt
PASS  -> execute
PAUSE -> queue for review
DENY  -> block before launch
```

Every decision writes a local receipt with the action, verdict, policy hash,
redactions, and execution result.

## Quick Start

```bash
npx github:CharonAI-code/charon setup
```

That single command creates local policy, creates a signed identity, installs
Charon into Codex as a required MCP server, guards existing MCP servers, runs a
self-test, and prints the final status.

Restart Codex after setup.

## Daily Commands

```bash
charon status
charon receipts
charon restore
```

`charon restore` removes Charon from Codex config and restores guarded MCP
servers to their original commands.

## Default Policy

The default policy is `balanced`:

```txt
normal local dev work       -> PASS
git push / remote writes    -> PAUSE
unknown network hosts       -> PAUSE
.env / private key reads    -> DENY
npm publish                 -> DENY
git push --force            -> DENY
rm -rf style commands       -> DENY
```

The policy lives in `charon.yml` and stays local to the repo.

## MCP Guard

Charon can wrap existing MCP servers:

```bash
charon mcp guard codex
charon mcp status codex
charon mcp unguard codex
```

Guarded MCP calls flow like this:

```txt
agent -> Charon MCP proxy -> policy decision -> upstream MCP server
```

`PASS` forwards the call. `PAUSE` and `DENY` return a tool error and write a
receipt.

## Receipts

```bash
charon receipts
charon receipts latest
charon receipts explain latest
charon receipts inspect latest
```

Receipts are stored under `.charon/receipts/` and redact secret-looking values
before they are written.

## Local Command Gate

For direct shell testing:

```bash
charon gate -- echo "hello"
charon gate -- git push
charon gate -- cat .env
```

Expected result:

```txt
echo      -> PASS
git push  -> PAUSE
cat .env  -> DENY
```

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

## Scope

Charon is local-first security infrastructure for AI agent actions.

- no hosted service required
- no payment layer
- no token
- policy stays local
- receipts stay local
- MCP and Codex support are live


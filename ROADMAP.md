# Charon Roadmap

Charon is a local policy plane for agent actions.

Core flow:

```txt
agent/tool requests action
-> Charon normalizes typed action data
-> policy decides PASS / PAUSE / DENY
-> trusted coordinator enforces
-> receipt proves what happened
```

## Current MVP

- CLI policy gate
- typed action model
- resource role registry
- trusted coordinator
- local review queue
- receipt v2
- receipt verification
- SDK `enforce()` entrypoint

## Next

1. MCP proxy
   Route MCP tool calls through the same coordinator.

2. Runtime adapters
   Add focused adapters for agent runtimes without changing core policy logic.

3. Policy compiler
   Convert `charon.yml` into a compact typed policy bundle.

4. Signed identity hardening
   Make signer loading, key rotation, and identity mismatch checks explicit.

5. Better review UX
   Improve queued-action summaries and approval safety checks.

6. Sandboxed execution
   Add optional execution backends after the policy plane is stable.

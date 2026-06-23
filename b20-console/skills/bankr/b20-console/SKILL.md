---
name: b20-console
description: >
  Inspect B20 token contract addresses on Base through B20 Console. Use this
  skill when a user asks whether a B20 contract is live, initialized, recognized
  by the B20 factory, what policies are attached, whether features are paused,
  or what risk flags are active. Calls the public B20 Console API and returns a
  concise risk summary with reasons. No API key required.
metadata:
  clawdbot:
    emoji: "🟩"
    homepage: "https://b20.charon.codes"
    requires:
      bins: ["node"]
---

# B20 Console

B20 Console inspects B20 token contract addresses on Base.

Use this skill when the user asks to check a B20 CA, inspect a B20 token, explain B20 risk flags, verify whether a token is actually B20, or compare policy / pause / supply state.

## What it checks

- contract existence
- B20 factory recognition
- initialization state
- token metadata
- supply and supply cap
- policy registry state
- pause state
- Permit / EIP-712 state
- source transaction when requested
- deterministic risk flags

## Workflow

1. Extract the contract address from the user request.
2. Pick the chain:
   - default: `base-sepolia`
   - use `base` only when the user asks for mainnet Base.
3. Run:

```bash
node scripts/inspect-b20.js 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia
```

4. If the user asks for provenance, creation transaction, or source, add `--source`:

```bash
node scripts/inspect-b20.js 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia --source
```

5. Return the result in plain language:
   - verdict line: `low`, `medium`, `high`, or `unknown`
   - active risk flags
   - policy / pause / supply findings
   - source transaction if loaded

Do not call a token safe only because the score is low. Say what was observed.

## Output style

Keep the answer short.

Good format:

```text
B20 Console result: low risk (15)

Active flag:
- supply_cap_unbounded: supply cap is set to the B20 max sentinel

State:
- B20: yes
- initialized: yes
- features: active
- policies: default allow policies
```

If the API returns an error, say the exact error code:

```text
B20 Console result: NOT_B20
This contract exists, but the B20 factory does not recognize it as a B20 token.
```

## Links

- App: https://b20.charon.codes
- API: https://b20.charon.codes/api/inspect
- Methodology: https://b20.charon.codes/methodology


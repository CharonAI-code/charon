# B20 Console: risk signals for B20 tokens on Base

## 1. TL;DR

B20 Console is a risk indicator for B20 tokens on Base.

Paste a contract address and it reads live onchain state. The output is a risk score with the exact flags behind it: factory recognition, initialization, policies, paused features, supply cap, Permit / EIP-712 state, and read warnings.

## 2. Why We Built It

ERC20 tokens are mostly inspected through metadata, supply, balances, and transfer behavior.

B20 adds token-level controls that need their own view: factory status, initialization, policy hooks, pause state, supply caps, and Permit / EIP-712 data.

B20 Console turns those reads into one risk indicator with reasons.

Risk here is not a binary scam label. It can mean:

- the address is not recognized by the B20 factory
- the token is not initialized
- a feature is paused
- a custom policy is attached
- a policy read failed
- the supply cap is unbounded
- permit / EIP-712 state is incomplete
- the selected chain does not expose the expected B20 registry state

## 3. What It Reads

B20 Console reads:

- contract existence and B20 factory status
- token metadata
- total supply and supply cap
- policy registry state and pause state
- Permit / EIP-712 data
- factory creation source when available

Invalid addresses, missing contracts, and non-B20 contracts return clean errors instead of a normal report.

## 4. Methodology

The risk indicator is deterministic.

B20 Console reads onchain state, normalizes the result, and applies rule-based checks. Each matched rule can add points and reasons. The final result becomes `low`, `medium`, `high`, or `unknown`.

Example flags:

- `not_b20`
- `not_initialized`
- `policy_custom`
- `paused`
- `supply_cap_unbounded`
- `read_warning`

This is not a final judgment on a token. It is a structured risk signal built from B20-specific state.

Full methodology:

https://b20.charon.codes/methodology

## 5. How To Use

Go to:

https://b20.charon.codes

Paste a B20 contract address.

Choose `Base Sepolia` or `Base`.

Click `Inspect`.

The report shows the risk indicator, active risk flags, status, token data, supply, policies, paused features, permit data, source info, and raw JSON.

Useful screenshots to include:

- a valid live B20 token
- a token with an active risk flag
- an invalid or unavailable contract
- the methodology page

## 6. End

B20 Console is live.

It is deterministic and built to make B20 token risk easier to inspect directly from onchain data.

https://b20.charon.codes

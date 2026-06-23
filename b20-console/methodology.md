# B20 Console Methodology

B20 Console is a read-only inspector for B20 tokens on Base.

It does not decide whether a token is good or bad. It reads onchain state, normalizes the result, and produces a deterministic risk score with reasons.

## Risk Model

Current methodology:

```txt
deterministic_rules_v1
```

The risk score is rule-based.

Each matched rule adds points. The final score is capped at `100`.

```txt
0-24    low
25-59   medium
60-100  high
```

If reads fail and the score is otherwise `0`, the level can be `unknown`.

## Inspection Flow

1. Validate the address format.
2. Check deployed bytecode at the address.
3. Check whether the B20 factory recognizes the token.
4. Read token metadata and supply data.
5. Read B20 policy IDs.
6. Read policy registry state.
7. Read pause state for B20 features.
8. Read permit / EIP-712 domain data.
9. Convert findings into risk reasons.

Invalid or unavailable contracts do not produce a normal report.

```txt
INVALID_ADDRESS  address is not valid
NO_CONTRACT      no contract exists at this address
NOT_B20          contract exists, but B20 factory does not recognize it
```

## Risk Flags

### b20_features_inactive

B20 features are not active on this chain.

Severity: high

This usually means the selected chain does not currently expose the expected B20 feature registry state.

### not_b20

The B20 factory does not recognize this address as a B20 token.

Severity: high

In the web app, this should usually be shown as an inspection error instead of a normal risk report.

### not_initialized

The address matches the B20 path but is not initialized.

Severity: high

An uninitialized B20 address is not a usable live token.

### policy_read_failed.\<scope\>

A policy ID could not be read from the token.

Severity: medium

This can mean the token does not expose the expected policy interface, the RPC failed, or the read reverted.

### policy_always_block.\<scope\>

The token uses an `ALWAYS_BLOCK` policy for the given scope.

Severity: high

This can block a category of token operation.

### policy_custom.\<scope\>

The token uses a custom policy for the given scope.

Severity: medium

Custom policy is not automatically bad, but it means behavior depends on policy logic outside the basic token surface.

### policy_missing.\<scope\>

The token points to a policy ID that does not exist in the policy registry.

Severity: high

This can create broken or unexpected behavior for the affected scope.

### policy_admin.\<scope\>

The policy has an active admin.

Severity: medium

An active admin can indicate mutable policy control.

### policy_pending_admin.\<scope\>

The policy has a pending admin transfer.

Severity: medium

This indicates policy control may change.

### paused.\<feature\>

A B20 feature is currently paused.

Severity: medium

Paused features can restrict token behavior.

### pause_read_failed.\<feature\>

The pause state for a feature could not be read.

Severity: medium

This is treated as uncertainty.

### supply_cap_unknown

Supply cap could not be read.

Severity: medium

The UI should avoid implying supply safety when the cap is unknown.

### supply_cap_unbounded

Supply cap is set to the B20 max sentinel.

Severity: medium

This means the token effectively has an unbounded cap inside the inspected model.

### supply_exceeds_cap

Total supply is greater than the reported supply cap.

Severity: high

This is a strong invariant failure.

### permit_incomplete

Permit / EIP-712 domain data could not be fully read.

Severity: low

This affects signing and approval UX.

### read_warning.\<step\>

One of the onchain reads failed.

Severity: low

The raw JSON should expose the failed step and error code.

## Deployer-Controlled Risk Surface

The most important deployer-controlled or deployer-influenced flags are:

```txt
policy_custom.*
policy_always_block.*
policy_missing.*
policy_admin.*
policy_pending_admin.*
paused.*
supply_cap_unbounded
supply_exceeds_cap
permit_incomplete
```

These should be the main focus of the methodology page.

## Policy Scopes

B20 Console currently reads policy state for these scopes:

```txt
TRANSFER_SENDER_POLICY
TRANSFER_RECIPIENT_POLICY
APPROVAL_SENDER_POLICY
APPROVAL_RECIPIENT_POLICY
```

Each scope has:

```txt
id
label
exists
admin
pendingAdmin
```

Policy labels:

```txt
ALWAYS_ALLOW
ALWAYS_BLOCK
CUSTOM
```

## Pausable Features

B20 Console currently reads pause state for:

```txt
transfer
approval
mint
```

Each feature can be:

```txt
active
paused
unknown
```

## UI Guidance

The methodology page should make the risk model inspectable.

Recommended sections:

```txt
Risk score
Inspection flow
Risk flags
Policy scopes
Paused features
Deployer-controlled risk
Error codes
```

Risk flags should be shown as short rows:

```txt
flag
severity
what it means
why it affects risk
```

The live inspector should link to this page near the risk rail.


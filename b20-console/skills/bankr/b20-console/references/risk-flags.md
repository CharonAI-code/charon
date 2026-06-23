# B20 Console Risk Flags

B20 Console risk is deterministic and rule-based.

Common flags:

- `not_b20`: B20 factory does not recognize the address.
- `not_initialized`: B20 factory says the token is not initialized.
- `b20_features_inactive`: selected chain does not expose active B20 feature state.
- `policy_custom`: a policy is attached that is not a default allow/block policy.
- `policy_missing`: expected policy state is missing.
- `policy_read_failed`: policy registry read failed.
- `paused`: one or more B20 features are paused.
- `pause_read_failed`: pause state could not be read.
- `supply_cap_unbounded`: supply cap is set to the B20 max sentinel.
- `supply_exceeds_cap`: total supply is greater than the reported cap.
- `permit_incomplete`: Permit / EIP-712 state is incomplete.
- `read_warning`: one of the inspection reads failed.

Risk levels:

- `low`: 0-24
- `medium`: 25-59
- `high`: 60-100
- `unknown`: reads failed and the state cannot be classified cleanly

Low risk does not mean "safe." It means the current deterministic checks found low-risk state.


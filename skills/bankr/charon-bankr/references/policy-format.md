# Policy Format

Policies are JSON or YAML objects with a default verdict, optional allowlists, optional thresholds, and ordered rules.

```json
{
  "version": 1,
  "default": "PASS",
  "allowlists": {
    "recipients": ["0x1111111111111111111111111111111111111111"],
    "chains": ["base", "ethereum", "solana"],
    "domains": ["api.bankr.bot"]
  },
  "thresholds": {
    "pause_amount_usd": 100,
    "deny_amount_usd": 1000
  },
  "rules": [
    {
      "id": "deny-large-transfer",
      "action": "wallet.transfer",
      "verdict": "DENY",
      "when": {
        "amount_usd_gt": 1000
      }
    }
  ]
}
```

Rules run in order. First match wins. If no rule matches, `default` is returned.

## Match Operators

`amount_usd_gt`: numeric greater-than check.

`amount_usd_gte`: numeric greater-than-or-equal check.

`amount_usd_lt`: numeric less-than check.

`chain_in`: action chain must be in the list.

`chain_not_in`: action chain must not be in the list.

`asset_in`: action asset must be in the list.

`recipient_in`: action recipient must be in the list.

`recipient_not_in`: action recipient must not be in the list.

`type_in`: action type must be in the list.

`method_in`: action method must be in the list.

`domain_in`: action domain must be in the list.

`domain_not_in`: action domain must not be in the list.

`field_exists`: named action field must exist.

`field_missing`: named action field must be missing.

# Receipt Format

Receipts record the policy decision for the normalized Bankr action.

```json
{
  "schema": "charon.bankr.receipt.v1",
  "receipt_id": "sha256:...",
  "created_at": "2026-06-16T00:00:00.000Z",
  "action": {
    "id": "bankr_001",
    "type": "wallet.transfer",
    "chain": "base",
    "asset": "ETH",
    "amount_usd": 850,
    "recipient": "0x0000000000000000000000000000000000000000"
  },
  "decision": {
    "verdict": "PAUSE",
    "matched_rule": "pause-large-transfer",
    "reason": "amount_usd_gt matched"
  },
  "execution": {
    "launched": false,
    "status": "not_launched"
  }
}
```

For `DENY` and `PAUSE`, `execution.launched` must be `false`.

For `PASS`, the receipt is still created before execution. A later runtime can append execution status if the host supports it.

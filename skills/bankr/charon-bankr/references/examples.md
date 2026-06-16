# Examples

## Large Transfer

`action.json`

```json
{
  "id": "demo-transfer",
  "type": "wallet.transfer",
  "source": "bankr",
  "chain": "base",
  "asset": "ETH",
  "amount": "0.5",
  "amount_usd": 1800,
  "recipient": "0x2222222222222222222222222222222222222222"
}
```

Run:

```bash
node scripts/charon_policy_check.js action.json templates/charon.policy.json
```

Expected verdict:

```json
{
  "verdict": "DENY",
  "matched_rule": "deny-large-wallet-action"
}
```

## Unknown Recipient

If `recipient_not_in` points at the allowlist and the address is not present, the verdict is `PAUSE`.

## Receipt

```bash
node scripts/charon_receipt.js action.json verdict.json
```

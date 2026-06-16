# Action Model

Charon checks Bankr actions after they are normalized into one object.

```json
{
  "id": "bankr_001",
  "type": "wallet.transfer",
  "chain": "base",
  "asset": "ETH",
  "amount": "0.25",
  "amount_usd": 850,
  "recipient": "0x0000000000000000000000000000000000000000",
  "recipient_label": "new-recipient",
  "source": "bankr",
  "intent": "send funds"
}
```

## Common Types

`wallet.transfer`

`token.swap`

`token.launch`

`automation.create`

`browser.open`

`api.request`

`portfolio.read`

## Required Fields

`type`: action class.

`source`: should be `bankr`.

## Recommended Fields

`chain`: chain name.

`asset`: token symbol or contract.

`amount`: native asset amount as a string.

`amount_usd`: numeric USD estimate.

`recipient`: wallet, contract, URL, domain, or API target.

`method`: contract/API/browser method when relevant.

`intent`: short user intent.

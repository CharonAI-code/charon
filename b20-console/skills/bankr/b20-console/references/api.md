# B20 Console API

Base endpoint:

```text
https://b20.charon.codes/api/inspect
```

Parameters:

- `address`: contract address to inspect.
- `chain`: `base-sepolia` or `base`.
- `source`: optional. Use `source=1` to include factory creation lookup.

Example:

```text
https://b20.charon.codes/api/inspect?chain=base-sepolia&address=0xb200000000000000000000c7d17966dc5e587ba0
```

With source lookup:

```text
https://b20.charon.codes/api/inspect?chain=base-sepolia&address=0xb200000000000000000000c7d17966dc5e587ba0&source=1
```

No API key is required.

Common error codes:

- `INVALID_ADDRESS`: address format is invalid.
- `NO_CONTRACT`: no deployed contract exists at the address.
- `NOT_B20`: contract exists, but the B20 factory does not recognize it.
- `UNSUPPORTED_CHAIN`: chain is not supported by B20 Console.
- `RPC_TIMEOUT`: RPC request timed out.
- `RPC_RATE_LIMITED`: public RPC rate limit was hit.


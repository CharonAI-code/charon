# B20 Console

Read-only B20 inspector.

## Run

```bash
npm install
npm run smoke
npm run smoke:source
npm run dev
```

Inspect a token:

```bash
node bin/b20-console.js inspect 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia
node bin/b20-console.js inspect 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia --json
node bin/b20-console.js inspect 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia --source
```

Supported chains:

- `base-sepolia`
- `vibenet`
- `base`

Mainnet currently returns no B20 precompile data from the public Base RPC, so the working backend target is Base Sepolia first.

## Web

```bash
npm run dev
```

Open:

```text
http://localhost:4173
```

API:

```text
GET /api/inspect?chain=base-sepolia&address=0xb200000000000000000000c7d17966dc5e587ba0
```

Standard inspection uses Multicall3 and returns the core report in roughly 1-3 seconds on public RPC.

Source inspection includes creation block/transaction:

```text
GET /api/inspect?chain=base-sepolia&address=0xb200000000000000000000c7d17966dc5e587ba0&source=1
```

The response includes:

- `timing`: inspection mode, duration, source lookup state
- `risk`: deterministic risk score, level, methodology, reasons
- `errors`: clean error codes such as `NO_CONTRACT`, `NOT_B20`, `RPC_TIMEOUT`, `RPC_RATE_LIMITED`, `INVALID_ADDRESS`

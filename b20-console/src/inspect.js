import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  keccak256,
  toBytes
} from "viem";
import { activationRegistryAbi, b20Abi, b20CreatedEventAbi, b20FactoryAbi, policyRegistryAbi } from "./abi.js";
import {
  ACTIVATION_REGISTRY_ADDRESS,
  B20_FACTORY_ADDRESS,
  CHAINS,
  PAUSABLE_FEATURES,
  POLICY_REGISTRY_ADDRESS,
  POLICY_SCOPES
} from "./constants.js";
import { cleanError, inspectError } from "./errors.js";
import { assessRisk } from "./risk.js";

export async function inspectB20({ address, chain = "base-sepolia", rpcUrl, includeSource = false } = {}) {
  const startedAt = Date.now();
  const chainConfig = CHAINS[chain];
  if (!chainConfig) throw inspectError("UNSUPPORTED_CHAIN", `unsupported chain: ${chain}`, 400, { chain });
  if (!isAddress(address)) throw inspectError("INVALID_ADDRESS", `invalid B20 address: ${address}`, 400, { address });

  const token = getAddress(address);
  const effectiveRpcUrl = rpcUrl || chainConfig.rpcUrl;
  const client = createPublicClient({
    chain: {
      id: chainConfig.id,
      name: chainConfig.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [effectiveRpcUrl] } },
      contracts: {
        multicall3: {
          address: "0xca11bde05977b3631167028862be2a173976ca11",
          blockCreated: 0
        }
      }
    },
    transport: http(effectiveRpcUrl)
  });

  const errors = [];
  const read = async (step, fn, fallback = null) => {
    try {
      return await fn();
    } catch (error) {
      errors.push(cleanError(step, error));
      return fallback;
    }
  };

  let bytecode;
  try {
    bytecode = await client.getCode({ address: token });
  } catch (error) {
    errors.push(cleanError("token.bytecode", error));
    throw inspectError("READ_FAILED", `could not read bytecode for ${token} on ${chainConfig.name}`, 502, {
      chain,
      address: token
    });
  }
  if (!bytecode || bytecode === "0x") {
    throw inspectError("NO_CONTRACT", `no contract deployed at ${token} on ${chainConfig.name}`, 422, {
      chain,
      address: token
    });
  }

  const headerCalls = [
    {
      step: "activation.base.b20_asset",
      contract: {
        address: ACTIVATION_REGISTRY_ADDRESS,
        abi: activationRegistryAbi,
        functionName: "isActivated",
        args: [keccak256(toBytes("base.b20_asset"))]
      }
    },
    {
      step: "activation.base.b20_stablecoin",
      contract: {
        address: ACTIVATION_REGISTRY_ADDRESS,
        abi: activationRegistryAbi,
        functionName: "isActivated",
        args: [keccak256(toBytes("base.b20_stablecoin"))]
      }
    },
    {
      step: "activation.admin",
      contract: {
        address: ACTIVATION_REGISTRY_ADDRESS,
        abi: activationRegistryAbi,
        functionName: "admin"
      }
    },
    {
      step: "factory.isB20",
      contract: {
        address: B20_FACTORY_ADDRESS,
        abi: b20FactoryAbi,
        functionName: "isB20",
        args: [token]
      }
    },
    {
      step: "factory.isB20Initialized",
      contract: {
        address: B20_FACTORY_ADDRESS,
        abi: b20FactoryAbi,
        functionName: "isB20Initialized",
        args: [token]
      }
    }
  ];
  const header = await readBatch(client, headerCalls, errors);
  const assetActive = header[0] ?? null;
  const stablecoinActive = header[1] ?? null;
  const activationAdmin = header[2] ?? null;
  const isB20 = header[3] ?? false;
  const initialized = header[4] ?? false;

  const b20FeaturesActive = Boolean(assetActive || stablecoinActive);

  if (!isB20) {
    throw inspectError("NOT_B20", `${token} is not recognized by the B20 factory on ${chainConfig.name}`, 422, {
      chain,
      address: token,
      b20FeaturesActive,
      initialized,
      variant: inferVariantFromAddress(token) === 0 ? "asset" : inferVariantFromAddress(token) === 1 ? "stablecoin" : "unknown"
    });
  }

  const tokenCalls = [
    { step: "token.name", contract: { address: token, abi: b20Abi, functionName: "name" } },
    { step: "token.symbol", contract: { address: token, abi: b20Abi, functionName: "symbol" } },
    { step: "token.decimals", contract: { address: token, abi: b20Abi, functionName: "decimals" } },
    { step: "token.totalSupply", contract: { address: token, abi: b20Abi, functionName: "totalSupply" } },
    { step: "token.supplyCap", contract: { address: token, abi: b20Abi, functionName: "supplyCap" } },
    { step: "token.contractURI", contract: { address: token, abi: b20Abi, functionName: "contractURI" } },
    ...POLICY_SCOPES.map((scope) => ({
      step: `token.policyId.${scope}`,
      contract: {
        address: token,
        abi: b20Abi,
        functionName: "policyId",
        args: [keccak256(toBytes(scope))]
      }
    })),
    ...PAUSABLE_FEATURES.map((feature) => ({
      step: `token.isPaused.${feature.name}`,
      contract: {
        address: token,
        abi: b20Abi,
        functionName: "isPaused",
        args: [feature.id]
      }
    })),
    { step: "token.DOMAIN_SEPARATOR", contract: { address: token, abi: b20Abi, functionName: "DOMAIN_SEPARATOR" } },
    { step: "token.eip712Domain", contract: { address: token, abi: b20Abi, functionName: "eip712Domain" } }
  ];
  const tokenReads = await readBatch(client, tokenCalls, errors);
  const [name, symbol, decimals, totalSupply, supplyCap, contractURI] = tokenReads.slice(0, 6);
  const policyIds = tokenReads.slice(6, 10);
  const pauseReads = tokenReads.slice(10, 13);
  const [domainSeparator, eip712DomainRaw] = tokenReads.slice(13, 15);

  const creation = includeSource ? await findRecentCreation(client, token, errors) : null;
  const variantId = creation?.variant ?? inferVariantFromAddress(token);
  const variant = variantId === 0 ? "asset" : variantId === 1 ? "stablecoin" : "unknown";

  const policyRegistryCalls = POLICY_SCOPES.flatMap((scope, index) => {
    const id = policyIds[index];
    if (id === null || id === undefined) return [];
    return [
      {
        step: `policy.${scope}.exists`,
        contract: { address: POLICY_REGISTRY_ADDRESS, abi: policyRegistryAbi, functionName: "policyExists", args: [id] }
      },
      {
        step: `policy.${scope}.admin`,
        contract: { address: POLICY_REGISTRY_ADDRESS, abi: policyRegistryAbi, functionName: "policyAdmin", args: [id] }
      },
      {
        step: `policy.${scope}.pendingAdmin`,
        contract: { address: POLICY_REGISTRY_ADDRESS, abi: policyRegistryAbi, functionName: "pendingPolicyAdmin", args: [id] }
      }
    ];
  });
  const policyDetails = await readBatch(client, policyRegistryCalls, errors);
  let detailIndex = 0;
  const policies = POLICY_SCOPES.map((scope, index) => {
    const id = policyIds[index];
    if (id === null || id === undefined) return { scope, id: null, label: null, exists: null, admin: null, pendingAdmin: null };
    const exists = policyDetails[detailIndex++] ?? null;
    const admin = policyDetails[detailIndex++] ?? null;
    const pendingAdmin = policyDetails[detailIndex++] ?? null;
    return { scope, id: id.toString(), label: labelPolicyId(id), exists, admin, pendingAdmin };
  });

  const pause = PAUSABLE_FEATURES.map((feature, index) => ({
    feature: feature.name,
    paused: pauseReads[index] ?? null
  }));

  const report = {
    chain: {
      key: chain,
      id: chainConfig.id,
      name: chainConfig.name,
      rpcUrl: effectiveRpcUrl,
      b20FeaturesActive
    },
    timing: {
      mode: includeSource ? "source" : "standard",
      durationMs: 0,
      sourceLookup: includeSource ? (creation ? "included" : "not_found") : "skipped"
    },
    token: {
      address: token,
      isB20,
      initialized,
      variant,
      name,
      symbol,
      decimals,
      totalSupply: totalSupply === null ? null : totalSupply.toString(),
      supplyCap: supplyCap === null ? null : supplyCap.toString(),
      contractURI
    },
    activation: {
      admin: activationAdmin,
      asset: assetActive,
      stablecoin: stablecoinActive
    },
    policies,
    pause,
    permit: {
      domainSeparator,
      eip712Domain: Array.isArray(eip712DomainRaw)
        ? {
            fields: eip712DomainRaw[0],
            name: eip712DomainRaw[1],
            version: eip712DomainRaw[2],
            chainId: eip712DomainRaw[3].toString(),
            verifyingContract: eip712DomainRaw[4],
            salt: eip712DomainRaw[5],
            extensions: eip712DomainRaw[6].map((value) => value.toString())
          }
        : null
    },
    source: {
      factory: B20_FACTORY_ADDRESS,
      policyRegistry: POLICY_REGISTRY_ADDRESS,
      activationRegistry: ACTIVATION_REGISTRY_ADDRESS,
      creationBlock: creation?.blockNumber?.toString() || null,
      creationTx: creation?.transactionHash || null
    },
    errors
  };
  report.risk = assessRisk(report);
  report.timing.durationMs = Date.now() - startedAt;
  return report;
}

async function findRecentCreation(client, token, errors) {
  const latest = await client.getBlockNumber();
  const span = client.chain.id === 84536917 ? 99_999n : 1_999n;
  let toBlock = latest;
  for (let i = 0; i < 30 && toBlock >= 0n; i += 1) {
    const fromBlock = toBlock > span ? toBlock - span : 0n;
    try {
      const logs = await client.getLogs({
        address: B20_FACTORY_ADDRESS,
        event: b20CreatedEventAbi,
        args: { token },
        fromBlock,
        toBlock
      });
      if (logs.length > 0) {
        const log = logs[logs.length - 1];
        const decoded = decodeEventLog({ abi: [b20CreatedEventAbi], data: log.data, topics: log.topics });
        return {
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          variant: Number(decoded.args.variant)
        };
      }
    } catch (error) {
      errors.push(cleanError("factory.B20Created", error));
      return null;
    }
    if (fromBlock === 0n) break;
    toBlock = fromBlock - 1n;
  }
  return null;
}

function labelPolicyId(id) {
  if (id === 0n) return "ALWAYS_ALLOW";
  if (id === 1n) return "ALWAYS_BLOCK";
  return "CUSTOM";
}

async function readBatch(client, calls, errors) {
  if (calls.length === 0) return [];
  try {
    const results = await client.multicall({
      contracts: calls.map((call) => call.contract),
      allowFailure: true
    });
    return results.map((result, index) => {
      if (result.status === "success") return result.result;
      errors.push(cleanError(calls[index].step, result.error));
      return null;
    });
  } catch (error) {
    for (const call of calls) errors.push(cleanError(call.step, error));
    return calls.map(() => null);
  }
}

function inferVariantFromAddress(address) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!hex.startsWith("b20") || hex.length !== 40) return null;
  const variantByte = Number.parseInt(hex.slice(20, 22), 16);
  if (variantByte === 0 || variantByte === 1) return variantByte;
  return null;
}

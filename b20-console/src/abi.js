export const b20FactoryAbi = [
  {
    type: "function",
    name: "isB20",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "isB20Initialized",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }]
  }
];

export const activationRegistryAbi = [
  {
    type: "function",
    name: "isActivated",
    stateMutability: "view",
    inputs: [{ name: "feature", type: "bytes32" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  }
];

export const policyRegistryAbi = [
  {
    type: "function",
    name: "policyExists",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint64" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "policyAdmin",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint64" }],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "pendingPolicyAdmin",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint64" }],
    outputs: [{ type: "address" }]
  }
];

export const b20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "supplyCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "policyId",
    stateMutability: "view",
    inputs: [{ name: "policyScope", type: "bytes32" }],
    outputs: [{ type: "uint64" }]
  },
  {
    type: "function",
    name: "isPaused",
    stateMutability: "view",
    inputs: [{ name: "feature", type: "uint8" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }]
  },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" }
    ]
  }
];

export const b20CreatedEventAbi = {
  type: "event",
  name: "B20Created",
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "variant", type: "uint8", indexed: true },
    { name: "name", type: "string", indexed: false },
    { name: "symbol", type: "string", indexed: false },
    { name: "decimals", type: "uint8", indexed: false },
    { name: "variantEventParams", type: "bytes", indexed: false }
  ]
};


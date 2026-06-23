export const B20_FACTORY_ADDRESS = "0xB20f000000000000000000000000000000000000";
export const POLICY_REGISTRY_ADDRESS = "0x8453000000000000000000000000000000000002";
export const ACTIVATION_REGISTRY_ADDRESS = "0x8453000000000000000000000000000000000001";

export const CHAINS = {
  base: {
    id: 8453,
    name: "Base mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://base.blockscout.com"
  },
  "base-sepolia": {
    id: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia-explorer.base.org"
  },
  vibenet: {
    id: 84536917,
    name: "Base vibenet",
    rpcUrl: "https://rpc.vibes.base.org/"
  }
};

export const POLICY_SCOPES = [
  "TRANSFER_SENDER_POLICY",
  "TRANSFER_RECEIVER_POLICY",
  "TRANSFER_EXECUTOR_POLICY",
  "MINT_RECEIVER_POLICY"
];

export const PAUSABLE_FEATURES = [
  { id: 0, name: "TRANSFER" },
  { id: 1, name: "MINT" },
  { id: 2, name: "BURN" }
];


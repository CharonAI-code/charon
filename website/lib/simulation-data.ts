export interface SimAction {
  id: string;
  runtime: string;
  toolName: string;
  resource: string;
  resourceRole: string;
  verdict: "PASS" | "PAUSE" | "DENY";
  ruleId: string;
  findings: string[];
  receiptHash: string;
  policyHash: string;
  timestamp: string;
}

const SAMPLE_RECEIPT_HASHES = [
  "ch:sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "ch:sha256:f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1",
  "ch:sha256:9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3",
  "ch:sha256:1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7",
  "ch:sha256:d4c3b2a1f0e9d8c7b6a5f4e3d2c1f0e9",
  "ch:sha256:7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1",
  "ch:sha256:e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6",
  "ch:sha256:5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9",
  "ch:sha256:b3a2c1d0e9f8a7b6c5d4e3f2a1b0c9d8",
  "ch:sha256:8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2",
  "ch:sha256:2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6",
  "ch:sha256:c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4",
  "ch:sha256:6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0",
  "ch:sha256:f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5",
  "ch:sha256:4e3d2c1b0a9f8e7d6c5b4a3f2e1f0d9c8",
  "ch:sha256:a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2",
  "ch:sha256:d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3",
  "ch:sha256:3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7",
  "ch:sha256:b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  "ch:sha256:7e6f5d4c3b2a1f0e9d8c7b6a5f4e3d2c1",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function ts(baseHour: number, minute: number, second: number, ms: number): string {
  return `${pad(baseHour)}:${pad(minute)}:${pad(second)}.${ms.toString().padStart(3, "0")}`;
}

export const ACTIONS: SimAction[] = [
  {
    id: "req_01",
    runtime: "codex",
    toolName: "shell.run",
    resource: "npm run lint",
    resourceRole: "shell-command",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[0],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 1, 247),
  },
  {
    id: "req_02",
    runtime: "codex",
    toolName: "fs.read",
    resource: "src/auth.ts",
    resourceRole: "read-path",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[1],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 2, 891),
  },
  {
    id: "req_03",
    runtime: "codex",
    toolName: "fs.read",
    resource: ".env",
    resourceRole: "read-path",
    verdict: "DENY",
    ruleId: "controls.files.deny",
    findings: ["SECRETS"],
    receiptHash: SAMPLE_RECEIPT_HASHES[2],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 3, 512),
  },
  {
    id: "req_04",
    runtime: "codex",
    toolName: "http.fetch",
    resource: "api.github.com/repos/org/project",
    resourceRole: "fetch-url",
    verdict: "PASS",
    ruleId: "controls.network.allow",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[3],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 4, 103),
  },
  {
    id: "req_05",
    runtime: "codex",
    toolName: "shell.run",
    resource: "npm test -- --coverage",
    resourceRole: "shell-command",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[4],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 5, 678),
  },
  {
    id: "req_06",
    runtime: "codex",
    toolName: "fs.write",
    resource: "src/components/Button.tsx",
    resourceRole: "write-path",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[5],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 6, 234),
  },
  {
    id: "req_07",
    runtime: "codex",
    toolName: "shell.run",
    resource: "rm -rf node_modules",
    resourceRole: "shell-command",
    verdict: "DENY",
    ruleId: "controls.commands.deny",
    findings: ["COMMANDS"],
    receiptHash: SAMPLE_RECEIPT_HASHES[6],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 6, 891),
  },
  {
    id: "req_08",
    runtime: "mcp",
    toolName: "github.create_pr",
    resource: "org/project:main → feat/auth",
    resourceRole: "mcp-tool",
    verdict: "PAUSE",
    ruleId: "release.git_push",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[7],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 7, 445),
  },
  {
    id: "req_09",
    runtime: "codex",
    toolName: "fs.read",
    resource: "~/.aws/credentials",
    resourceRole: "read-path",
    verdict: "DENY",
    ruleId: "controls.files.deny",
    findings: ["SECRETS"],
    receiptHash: SAMPLE_RECEIPT_HASHES[8],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 8, 112),
  },
  {
    id: "req_10",
    runtime: "codex",
    toolName: "http.fetch",
    resource: "webhook.site/abc123",
    resourceRole: "fetch-url",
    verdict: "DENY",
    ruleId: "controls.network.default",
    findings: ["NETWORK"],
    receiptHash: SAMPLE_RECEIPT_HASHES[9],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 8, 923),
  },
  {
    id: "req_11",
    runtime: "codex",
    toolName: "shell.run",
    resource: "git status",
    resourceRole: "shell-command",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[10],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 9, 356),
  },
  {
    id: "req_12",
    runtime: "codex",
    toolName: "fs.write",
    resource: ".charon/queue/req_08.json",
    resourceRole: "write-path",
    verdict: "PASS",
    ruleId: "controls.files.write",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[11],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 9, 782),
  },
  {
    id: "req_13",
    runtime: "codex",
    toolName: "shell.run",
    resource: "git push --force origin main",
    resourceRole: "shell-command",
    verdict: "DENY",
    ruleId: "controls.commands.deny",
    findings: ["COMMANDS", "SOCIAL"],
    receiptHash: SAMPLE_RECEIPT_HASHES[12],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 10, 415),
  },
  {
    id: "req_14",
    runtime: "mcp",
    toolName: "filesystem.read",
    resource: "~/src/secrets.ts",
    resourceRole: "read-path",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[13],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 10, 998),
  },
  {
    id: "req_15",
    runtime: "codex",
    toolName: "shell.run",
    resource: "openssl enc -d -aes-256-cbc -in secrets.enc",
    resourceRole: "shell-command",
    verdict: "DENY",
    ruleId: "inspection.obfuscation",
    findings: ["OBFUSCATION", "COMMANDS"],
    receiptHash: SAMPLE_RECEIPT_HASHES[14],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 11, 623),
  },
  {
    id: "req_16",
    runtime: "codex",
    toolName: "http.fetch",
    resource: "api.github.com/repos/org/project/pulls",
    resourceRole: "fetch-url",
    verdict: "PASS",
    ruleId: "controls.network.allow",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[15],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 12, 89),
  },
  {
    id: "req_17",
    runtime: "codex",
    toolName: "git.run",
    resource: "git push origin feat/new-auth",
    resourceRole: "shell-command",
    verdict: "PAUSE",
    ruleId: "release.git_push",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[16],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 12, 734),
  },
  {
    id: "req_18",
    runtime: "codex",
    toolName: "fs.read",
    resource: "~/.ssh/id_ed25519",
    resourceRole: "read-path",
    verdict: "DENY",
    ruleId: "controls.files.deny",
    findings: ["SECRETS"],
    receiptHash: SAMPLE_RECEIPT_HASHES[17],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 13, 451),
  },
  {
    id: "req_19",
    runtime: "codex",
    toolName: "shell.run",
    resource: "npm run build",
    resourceRole: "shell-command",
    verdict: "PASS",
    ruleId: "default.pass",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[18],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 14, 267),
  },
  {
    id: "req_20",
    runtime: "codex",
    toolName: "shell.run",
    resource: "kubectl apply -f deployment.yaml",
    resourceRole: "shell-command",
    verdict: "PAUSE",
    ruleId: "bounds.pause",
    findings: [],
    receiptHash: SAMPLE_RECEIPT_HASHES[19],
    policyHash: "ph:sha256:03f7a1c2b4d5e6f8a9c0d1e2f3a4b5c6",
    timestamp: ts(14, 32, 14, 892),
  },
];

export const POLICY_YAML = `version: 1
default: pass
bounds:
  pause:
    - git push
    - deploy production
    - kubectl apply
  deny:
    - git push --force
    - npm publish
    - rm -rf
    - read:.env
files:
  allow: [.charon/**]
  deny: [.env, ~/.ssh/**, ~/.aws/**]
network:
  allow: [github.com, api.github.com]
commands:
  deny: [git push --force, npm publish, rm -rf]
inspection: enforce`;
